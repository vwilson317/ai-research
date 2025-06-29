"""
Audio processing utilities for preparing audio files for transcription.
"""

import os
import tempfile
from pathlib import Path
from typing import Optional, Tuple
import logging

import numpy as np
from pydub import AudioSegment
from pydub.exceptions import CouldntDecodeError


class AudioProcessor:
    """Handles audio file preprocessing for optimal transcription."""
    
    def __init__(self, config: dict):
        """
        Initialize AudioProcessor with configuration.
        
        Args:
            config: Configuration dictionary containing audio settings
        """
        self.config = config
        self.audio_config = config.get('audio', {})
        self.preprocessing_config = self.audio_config.get('preprocessing', {})
        self.logger = logging.getLogger('audio_transcriber')
        
        # Audio processing parameters
        self.target_sample_rate = self.preprocessing_config.get('target_sample_rate', 16000)
        self.convert_to_mono = self.preprocessing_config.get('convert_to_mono', True)
        self.normalize = self.preprocessing_config.get('normalize', True)
    
    def process_audio_file(self, audio_path: Path) -> Optional[Path]:
        """
        Process an audio file for transcription.
        
        Args:
            audio_path: Path to the input audio file
            
        Returns:
            Path to the processed audio file, or None if processing failed
        """
        try:
            self.logger.info(f"Processing audio file: {audio_path}")
            
            # Load audio file
            audio = self._load_audio(audio_path)
            if audio is None:
                return None
            
            # Apply preprocessing
            processed_audio = self._preprocess_audio(audio)
            
            # Save processed audio to temporary file
            temp_file = self._save_processed_audio(processed_audio, audio_path)
            
            self.logger.info(f"Successfully processed: {audio_path}")
            return temp_file
            
        except Exception as e:
            self.logger.error(f"Error processing audio file {audio_path}: {e}")
            return None
    
    def _load_audio(self, audio_path: Path) -> Optional[AudioSegment]:
        """
        Load audio file using pydub.
        
        Args:
            audio_path: Path to the audio file
            
        Returns:
            AudioSegment object or None if loading failed
        """
        try:
            # Check file size
            file_size = audio_path.stat().st_size
            max_size = self.audio_config.get('max_file_size_mb', 500) * 1024 * 1024
            
            if file_size > max_size:
                self.logger.warning(f"File {audio_path} is too large ({file_size} bytes)")
                return None
            
            # Load audio file
            audio = AudioSegment.from_file(str(audio_path))
            self.logger.debug(f"Loaded audio: {audio_path}, duration: {len(audio)/1000:.2f}s")
            
            return audio
            
        except CouldntDecodeError as e:
            self.logger.error(f"Could not decode audio file {audio_path}: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Error loading audio file {audio_path}: {e}")
            return None
    
    def _preprocess_audio(self, audio: AudioSegment) -> AudioSegment:
        """
        Apply preprocessing to audio for optimal transcription.
        
        Args:
            audio: Input AudioSegment
            
        Returns:
            Processed AudioSegment
        """
        # Convert to mono if requested
        if self.convert_to_mono and audio.channels > 1:
            audio = audio.set_channels(1)
            self.logger.debug("Converted audio to mono")
        
        # Set sample rate
        if audio.frame_rate != self.target_sample_rate:
            audio = audio.set_frame_rate(self.target_sample_rate)
            self.logger.debug(f"Set sample rate to {self.target_sample_rate}Hz")
        
        # Normalize audio levels
        if self.normalize:
            audio = self._normalize_audio(audio)
        
        return audio
    
    def _normalize_audio(self, audio: AudioSegment) -> AudioSegment:
        """
        Normalize audio levels to improve transcription quality.
        
        Args:
            audio: Input AudioSegment
            
        Returns:
            Normalized AudioSegment
        """
        # Calculate target dBFS (decibels relative to full scale)
        target_dbfs = -20.0
        
        # Normalize to target dBFS
        change_in_dbfs = target_dbfs - audio.dBFS
        normalized_audio = audio.apply_gain(change_in_dbfs)
        
        self.logger.debug(f"Normalized audio from {audio.dBFS:.2f} dBFS to {normalized_audio.dBFS:.2f} dBFS")
        
        return normalized_audio
    
    def _save_processed_audio(self, audio: AudioSegment, original_path: Path) -> Path:
        """
        Save processed audio to a temporary WAV file.
        
        Args:
            audio: Processed AudioSegment
            original_path: Original audio file path (for naming)
            
        Returns:
            Path to the temporary processed audio file
        """
        # Create temporary file
        temp_dir = tempfile.gettempdir()
        temp_filename = f"processed_{original_path.stem}.wav"
        temp_path = Path(temp_dir) / temp_filename
        
        # Export as WAV (Whisper prefers WAV format)
        audio.export(
            str(temp_path),
            format="wav",
            parameters=["-ar", str(self.target_sample_rate)]
        )
        
        self.logger.debug(f"Saved processed audio to: {temp_path}")
        return temp_path
    
    def cleanup_temp_file(self, temp_path: Path) -> None:
        """
        Clean up temporary processed audio file.
        
        Args:
            temp_path: Path to temporary file to delete
        """
        try:
            if temp_path.exists():
                temp_path.unlink()
                self.logger.debug(f"Cleaned up temporary file: {temp_path}")
        except Exception as e:
            self.logger.warning(f"Could not clean up temporary file {temp_path}: {e}")
    
    def get_audio_info(self, audio_path: Path) -> Optional[dict]:
        """
        Get information about an audio file.
        
        Args:
            audio_path: Path to the audio file
            
        Returns:
            Dictionary with audio information or None if failed
        """
        try:
            audio = AudioSegment.from_file(str(audio_path))
            
            info = {
                'duration_seconds': len(audio) / 1000.0,
                'sample_rate': audio.frame_rate,
                'channels': audio.channels,
                'bit_depth': audio.sample_width * 8,
                'file_size_mb': audio_path.stat().st_size / (1024 * 1024),
                'dbfs': audio.dBFS
            }
            
            return info
            
        except Exception as e:
            self.logger.error(f"Error getting audio info for {audio_path}: {e}")
            return None 