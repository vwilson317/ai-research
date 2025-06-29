"""
iCloud file management and synchronization utilities.
"""

import shutil
import logging
from pathlib import Path
from typing import Optional, List
import time


class CloudSync:
    """Handles iCloud file management and synchronization."""
    
    def __init__(self, config: dict):
        """
        Initialize CloudSync with configuration.
        
        Args:
            config: Configuration dictionary containing iCloud settings
        """
        self.config = config
        self.icloud_config = config.get('icloud', {})
        self.logger = logging.getLogger('audio_transcriber')
        
        # iCloud paths
        self.base_path = Path(self.icloud_config.get('base_path', ''))
        self.audio_source = self.base_path / self.icloud_config.get('audio_source', 'Audio Files')
        self.transcript_dest = self.base_path / self.icloud_config.get('transcript_dest', 'Transcripts')
    
    def ensure_directories_exist(self) -> bool:
        """
        Ensure iCloud directories exist.
        
        Returns:
            True if directories are ready, False otherwise
        """
        try:
            # Check if iCloud base path exists
            if not self.base_path.exists():
                self.logger.error(f"iCloud base path does not exist: {self.base_path}")
                self.logger.error("Please ensure iCloud Drive is enabled and synced")
                return False
            
            # Create audio source directory if it doesn't exist
            if not self.audio_source.exists():
                self.audio_source.mkdir(parents=True, exist_ok=True)
                self.logger.info(f"Created audio source directory: {self.audio_source}")
            
            # Create transcript destination directory if it doesn't exist
            if not self.transcript_dest.exists():
                self.transcript_dest.mkdir(parents=True, exist_ok=True)
                self.logger.info(f"Created transcript destination directory: {self.transcript_dest}")
            
            return True
            
        except Exception as e:
            self.logger.error(f"Error ensuring directories exist: {e}")
            return False
    
    def save_transcript_to_icloud(self, transcript_path: Path, original_audio_path: Path) -> bool:
        """
        Save transcript to iCloud Drive.
        
        Args:
            transcript_path: Path to the transcript file
            original_audio_path: Path to the original audio file
            
        Returns:
            True if saved successfully, False otherwise
        """
        try:
            if not transcript_path.exists():
                self.logger.error(f"Transcript file does not exist: {transcript_path}")
                return False
            
            # Generate destination path in iCloud
            transcript_name = self._generate_transcript_name(original_audio_path)
            dest_path = self.transcript_dest / transcript_name
            
            # Ensure destination directory exists
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Copy transcript to iCloud
            shutil.copy2(transcript_path, dest_path)
            
            self.logger.info(f"Saved transcript to iCloud: {dest_path}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error saving transcript to iCloud: {e}")
            return False
    
    def _generate_transcript_name(self, audio_path: Path) -> str:
        """
        Generate transcript filename based on audio file.
        
        Args:
            audio_path: Path to the original audio file
            
        Returns:
            Transcript filename
        """
        output_format = self.config.get('transcription', {}).get('output_format', 'txt')
        
        # Preserve directory structure relative to audio source
        try:
            relative_path = audio_path.relative_to(self.audio_source)
            transcript_name = f"{relative_path.stem}_transcript.{output_format}"
            
            # If audio file is in a subdirectory, preserve that structure
            if relative_path.parent != Path('.'):
                return str(relative_path.parent / transcript_name)
            else:
                return transcript_name
                
        except ValueError:
            # Audio file is not in the expected source directory
            return f"{audio_path.stem}_transcript.{output_format}"
    
    def wait_for_icloud_sync(self, file_path: Path, timeout: int = 60) -> bool:
        """
        Wait for a file to be synced to iCloud.
        
        Args:
            file_path: Path to the file to wait for
            timeout: Maximum time to wait in seconds
            
        Returns:
            True if file is synced, False if timeout
        """
        try:
            start_time = time.time()
            
            while time.time() - start_time < timeout:
                if file_path.exists():
                    # Check if file is fully synced (not just created)
                    try:
                        # Try to read the file to ensure it's fully written
                        with open(file_path, 'r') as f:
                            f.read(1024)  # Read first 1KB
                        return True
                    except (IOError, OSError):
                        # File might still be being written
                        time.sleep(1)
                        continue
                
                time.sleep(1)
            
            self.logger.warning(f"Timeout waiting for iCloud sync: {file_path}")
            return False
            
        except Exception as e:
            self.logger.error(f"Error waiting for iCloud sync: {e}")
            return False
    
    def get_icloud_status(self) -> dict:
        """
        Get status of iCloud directories.
        
        Returns:
            Dictionary with iCloud status information
        """
        status = {
            'base_path_exists': self.base_path.exists(),
            'audio_source_exists': self.audio_source.exists(),
            'transcript_dest_exists': self.transcript_dest.exists(),
            'paths': {
                'base_path': str(self.base_path),
                'audio_source': str(self.audio_source),
                'transcript_dest': str(self.transcript_dest)
            }
        }
        
        # Get directory statistics if they exist
        if self.audio_source.exists():
            try:
                audio_files = list(self.audio_source.rglob('*'))
                status['audio_files_count'] = len([f for f in audio_files if f.is_file()])
                status['audio_directories_count'] = len([f for f in audio_files if f.is_dir()])
            except Exception as e:
                self.logger.warning(f"Error counting audio files: {e}")
                status['audio_files_count'] = 0
                status['audio_directories_count'] = 0
        
        if self.transcript_dest.exists():
            try:
                transcript_files = list(self.transcript_dest.rglob('*'))
                status['transcript_files_count'] = len([f for f in transcript_files if f.is_file()])
                status['transcript_directories_count'] = len([f for f in transcript_files if f.is_dir()])
            except Exception as e:
                self.logger.warning(f"Error counting transcript files: {e}")
                status['transcript_files_count'] = 0
                status['transcript_directories_count'] = 0
        
        return status
    
    def cleanup_old_transcripts(self, days_old: int = 30) -> int:
        """
        Clean up old transcript files.
        
        Args:
            days_old: Remove transcripts older than this many days
            
        Returns:
            Number of files removed
        """
        try:
            if not self.transcript_dest.exists():
                return 0
            
            cutoff_time = time.time() - (days_old * 24 * 60 * 60)
            removed_count = 0
            
            for transcript_file in self.transcript_dest.rglob('*'):
                if transcript_file.is_file():
                    try:
                        if transcript_file.stat().st_mtime < cutoff_time:
                            transcript_file.unlink()
                            removed_count += 1
                            self.logger.debug(f"Removed old transcript: {transcript_file}")
                    except Exception as e:
                        self.logger.warning(f"Error removing old transcript {transcript_file}: {e}")
            
            if removed_count > 0:
                self.logger.info(f"Cleaned up {removed_count} old transcript files")
            
            return removed_count
            
        except Exception as e:
            self.logger.error(f"Error cleaning up old transcripts: {e}")
            return 0 