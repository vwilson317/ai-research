"""
Speech-to-text transcription using OpenAI Whisper.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
import whisper


class Transcriber:
    """Handles speech-to-text transcription using OpenAI Whisper."""
    
    def __init__(self, config: dict):
        """
        Initialize Transcriber with configuration.
        
        Args:
            config: Configuration dictionary containing transcription settings
        """
        self.config = config
        self.transcription_config = config.get('transcription', {})
        self.logger = logging.getLogger('audio_transcriber')
        
        # Transcription parameters
        self.model_size = self.transcription_config.get('model_size', 'base')
        self.language = self.transcription_config.get('language', 'auto')
        self.include_timestamps = self.transcription_config.get('include_timestamps', False)
        self.output_format = self.transcription_config.get('output_format', 'txt')
        self.task = self.transcription_config.get('task', 'transcribe')
        
        # Load Whisper model
        self.model = None
        self._load_model()
    
    def _load_model(self) -> None:
        """Load the Whisper model."""
        try:
            self.logger.info(f"Loading Whisper model: {self.model_size}")
            self.model = whisper.load_model(self.model_size)
            self.logger.info(f"Successfully loaded Whisper model: {self.model_size}")
        except Exception as e:
            self.logger.error(f"Error loading Whisper model: {e}")
            raise
    
    def transcribe_audio(self, audio_path: Path) -> Optional[Dict[str, Any]]:
        """
        Transcribe an audio file to text.
        
        Args:
            audio_path: Path to the audio file to transcribe
            
        Returns:
            Dictionary containing transcription results or None if failed
        """
        try:
            self.logger.info(f"Starting transcription: {audio_path}")
            
            if self.model is None:
                self.logger.error("Whisper model not loaded")
                return None
            
            # Prepare transcription options
            options = {
                'task': self.task,
                'verbose': False
            }
            
            # Set language if specified
            if self.language != 'auto':
                options['language'] = self.language
            
            # Transcribe audio
            result = self.model.transcribe(str(audio_path), **options)
            
            # Process results
            transcription_data = self._process_transcription_result(result, audio_path)
            
            self.logger.info(f"Successfully transcribed: {audio_path}")
            return transcription_data
            
        except Exception as e:
            self.logger.error(f"Error transcribing audio file {audio_path}: {e}")
            return None
    
    def _process_transcription_result(self, result: Dict[str, Any], audio_path: Path) -> Dict[str, Any]:
        """
        Process Whisper transcription result.
        
        Args:
            result: Raw Whisper transcription result
            audio_path: Original audio file path
            
        Returns:
            Processed transcription data
        """
        # Extract basic information
        transcription_data = {
            'audio_file': str(audio_path),
            'text': result.get('text', '').strip(),
            'language': result.get('language', 'unknown'),
            'segments': result.get('segments', []),
            'metadata': {
                'model_size': self.model_size,
                'task': self.task,
                'timestamp_included': self.include_timestamps
            }
        }
        
        # Add segments with timestamps if requested
        if self.include_timestamps and result.get('segments'):
            transcription_data['segments'] = [
                {
                    'start': segment.get('start', 0),
                    'end': segment.get('end', 0),
                    'text': segment.get('text', '').strip()
                }
                for segment in result['segments']
            ]
        
        return transcription_data
    
    def save_transcript(self, transcription_data: Dict[str, Any], output_path: Path) -> bool:
        """
        Save transcription to file in the specified format.
        
        Args:
            transcription_data: Transcription data dictionary
            output_path: Path where to save the transcript
            
        Returns:
            True if saved successfully, False otherwise
        """
        try:
            self.logger.info(f"Saving transcript to: {output_path}")
            
            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            if self.output_format == 'json':
                self._save_json(transcription_data, output_path)
            elif self.output_format == 'srt':
                self._save_srt(transcription_data, output_path)
            else:  # Default to txt
                self._save_txt(transcription_data, output_path)
            
            self.logger.info(f"Successfully saved transcript: {output_path}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error saving transcript to {output_path}: {e}")
            return False
    
    def _save_txt(self, transcription_data: Dict[str, Any], output_path: Path) -> None:
        """Save transcript as plain text."""
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(transcription_data['text'])
    
    def _save_json(self, transcription_data: Dict[str, Any], output_path: Path) -> None:
        """Save transcript as JSON with full metadata."""
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(transcription_data, f, indent=2, ensure_ascii=False)
    
    def _save_srt(self, transcription_data: Dict[str, Any], output_path: Path) -> None:
        """Save transcript as SRT subtitle format."""
        segments = transcription_data.get('segments', [])
        
        with open(output_path, 'w', encoding='utf-8') as f:
            for i, segment in enumerate(segments, 1):
                start_time = self._format_timestamp(segment.get('start', 0))
                end_time = self._format_timestamp(segment.get('end', 0))
                text = segment.get('text', '').strip()
                
                f.write(f"{i}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{text}\n\n")
    
    def _format_timestamp(self, seconds: float) -> str:
        """Format seconds to SRT timestamp format (HH:MM:SS,mmm)."""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millisecs = int((seconds % 1) * 1000)
        
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millisecs:03d}"
    
    def get_transcription_stats(self, transcription_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get statistics about the transcription.
        
        Args:
            transcription_data: Transcription data dictionary
            
        Returns:
            Dictionary with transcription statistics
        """
        text = transcription_data.get('text', '')
        segments = transcription_data.get('segments', [])
        
        stats = {
            'word_count': len(text.split()),
            'character_count': len(text),
            'segment_count': len(segments),
            'language': transcription_data.get('language', 'unknown'),
            'model_used': self.model_size
        }
        
        # Calculate duration if segments are available
        if segments:
            start_time = segments[0].get('start', 0) if segments else 0
            end_time = segments[-1].get('end', 0) if segments else 0
            stats['duration_seconds'] = end_time - start_time
        
        return stats 