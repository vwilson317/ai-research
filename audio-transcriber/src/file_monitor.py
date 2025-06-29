"""
File monitoring and batch processing for audio files in iCloud.
"""

import time
import logging
from pathlib import Path
from typing import List, Set, Optional, Callable
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import click


class AudioFileHandler(FileSystemEventHandler):
    """Handles file system events for audio files."""
    
    def __init__(self, callback: Callable[[Path], None], supported_formats: List[str]):
        """
        Initialize AudioFileHandler.
        
        Args:
            callback: Function to call when new audio file is detected
            supported_formats: List of supported audio file extensions
        """
        self.callback = callback
        self.supported_formats = [fmt.lower() for fmt in supported_formats]
        self.logger = logging.getLogger('audio_transcriber')
        self.processed_files: Set[str] = set()
    
    def on_created(self, event):
        """Handle file creation events."""
        if not event.is_directory:
            file_path = Path(event.src_path)
            if self._is_audio_file(file_path):
                self.logger.info(f"New audio file detected: {file_path}")
                # Wait a moment for file to be fully written
                time.sleep(2)
                self.callback(file_path)
    
    def on_moved(self, event):
        """Handle file move events."""
        if not event.is_directory:
            file_path = Path(event.dest_path)
            if self._is_audio_file(file_path):
                self.logger.info(f"Audio file moved to: {file_path}")
                time.sleep(2)
                self.callback(file_path)
    
    def _is_audio_file(self, file_path: Path) -> bool:
        """Check if file is a supported audio file."""
        return file_path.suffix.lower() in self.supported_formats


class FileMonitor:
    """Monitors directories for new audio files and manages batch processing."""
    
    def __init__(self, config: dict, callback: Callable[[Path], None]):
        """
        Initialize FileMonitor.
        
        Args:
            config: Configuration dictionary
            callback: Function to call for each audio file
        """
        self.config = config
        self.callback = callback
        self.logger = logging.getLogger('audio_transcriber')
        
        # Configuration
        self.monitoring_config = config.get('monitoring', {})
        self.audio_config = config.get('audio', {})
        self.supported_formats = self.audio_config.get('supported_formats', [])
        
        # Monitoring state
        self.observer = None
        self.is_monitoring = False
        self.processed_files: Set[str] = set()
    
    def start_monitoring(self, source_path: Path) -> bool:
        """
        Start monitoring a directory for new audio files.
        
        Args:
            source_path: Directory to monitor
            
        Returns:
            True if monitoring started successfully
        """
        try:
            if not source_path.exists():
                self.logger.error(f"Source directory does not exist: {source_path}")
                return False
            
            if not source_path.is_dir():
                self.logger.error(f"Source path is not a directory: {source_path}")
                return False
            
            # Create event handler
            event_handler = AudioFileHandler(self.callback, self.supported_formats)
            
            # Create observer
            self.observer = Observer()
            self.observer.schedule(event_handler, str(source_path), recursive=True)
            
            # Start monitoring
            self.observer.start()
            self.is_monitoring = True
            
            self.logger.info(f"Started monitoring directory: {source_path}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error starting file monitoring: {e}")
            return False
    
    def stop_monitoring(self) -> None:
        """Stop file monitoring."""
        if self.observer and self.is_monitoring:
            self.observer.stop()
            self.observer.join()
            self.is_monitoring = False
            self.logger.info("Stopped file monitoring")
    
    def process_existing_files(self, source_path: Path, dest_path: Path) -> List[Path]:
        """
        Process all existing audio files in the source directory.
        
        Args:
            source_path: Directory containing audio files
            dest_path: Directory for transcript output
            
        Returns:
            List of processed file paths
        """
        processed_files = []
        
        try:
            if not source_path.exists():
                self.logger.warning(f"Source directory does not exist: {source_path}")
                return processed_files
            
            # Find all audio files
            audio_files = self._find_audio_files(source_path)
            
            if not audio_files:
                self.logger.info("No audio files found in source directory")
                return processed_files
            
            self.logger.info(f"Found {len(audio_files)} audio files to process")
            
            # Check for existing transcripts
            skip_existing = self.monitoring_config.get('skip_existing', True)
            if skip_existing:
                audio_files = self._filter_existing_transcripts(audio_files, dest_path)
                self.logger.info(f"After filtering existing transcripts: {len(audio_files)} files")
            
            # Process files
            for audio_file in audio_files:
                try:
                    self.callback(audio_file)
                    processed_files.append(audio_file)
                except Exception as e:
                    self.logger.error(f"Error processing file {audio_file}: {e}")
            
            return processed_files
            
        except Exception as e:
            self.logger.error(f"Error processing existing files: {e}")
            return processed_files
    
    def _find_audio_files(self, directory: Path) -> List[Path]:
        """
        Find all audio files in a directory recursively.
        
        Args:
            directory: Directory to search
            
        Returns:
            List of audio file paths
        """
        audio_files = []
        
        try:
            for file_path in directory.rglob('*'):
                if file_path.is_file() and self._is_audio_file(file_path):
                    audio_files.append(file_path)
        except Exception as e:
            self.logger.error(f"Error searching for audio files: {e}")
        
        return sorted(audio_files)
    
    def _is_audio_file(self, file_path: Path) -> bool:
        """Check if file is a supported audio file."""
        return file_path.suffix.lower() in self.supported_formats
    
    def _filter_existing_transcripts(self, audio_files: List[Path], dest_path: Path) -> List[Path]:
        """
        Filter out audio files that already have transcripts.
        
        Args:
            audio_files: List of audio file paths
            dest_path: Directory containing transcripts
            
        Returns:
            List of audio files without existing transcripts
        """
        filtered_files = []
        
        for audio_file in audio_files:
            transcript_name = self._get_transcript_name(audio_file)
            transcript_path = dest_path / transcript_name
            
            if not transcript_path.exists():
                filtered_files.append(audio_file)
            else:
                self.logger.debug(f"Skipping {audio_file} - transcript exists")
        
        return filtered_files
    
    def _get_transcript_name(self, audio_file: Path) -> str:
        """Generate transcript filename for an audio file."""
        output_format = self.config.get('transcription', {}).get('output_format', 'txt')
        return f"{audio_file.stem}_transcript.{output_format}"
    
    def get_file_stats(self, source_path: Path) -> dict:
        """
        Get statistics about audio files in the source directory.
        
        Args:
            source_path: Directory to analyze
            
        Returns:
            Dictionary with file statistics
        """
        try:
            audio_files = self._find_audio_files(source_path)
            
            stats = {
                'total_files': len(audio_files),
                'total_size_mb': 0,
                'formats': {}
            }
            
            for audio_file in audio_files:
                # Calculate total size
                file_size = audio_file.stat().st_size / (1024 * 1024)  # MB
                stats['total_size_mb'] += file_size
                
                # Count formats
                extension = audio_file.suffix.lower()
                stats['formats'][extension] = stats['formats'].get(extension, 0) + 1
            
            return stats
            
        except Exception as e:
            self.logger.error(f"Error getting file stats: {e}")
            return {'total_files': 0, 'total_size_mb': 0, 'formats': {}} 