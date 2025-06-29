"""
Main entry point for the Audio Transcriber application.
"""

import sys
import signal
import logging
from pathlib import Path
from typing import Optional
import click

from .utils import load_config, setup_logging, validate_config, get_icloud_paths, format_file_size
from .audio_processor import AudioProcessor
from .transcriber import Transcriber
from .file_monitor import FileMonitor
from .cloud_sync import CloudSync


class AudioTranscriber:
    """Main application class that orchestrates all components."""
    
    def __init__(self, config_path: str = "config/settings.yaml"):
        """
        Initialize AudioTranscriber.
        
        Args:
            config_path: Path to configuration file
        """
        self.config_path = config_path
        self.config = load_config(config_path)
        self.logger = None
        self.audio_processor = None
        self.transcriber = None
        self.file_monitor = None
        self.cloud_sync = None
        self.is_running = False
        
        # Initialize components
        self._initialize_components()
    
    def _initialize_components(self) -> None:
        """Initialize all application components."""
        try:
            # Setup logging
            self.logger = setup_logging(self.config)
            
            # Validate configuration
            if not validate_config(self.config):
                raise ValueError("Invalid configuration")
            
            # Initialize components
            self.audio_processor = AudioProcessor(self.config)
            self.transcriber = Transcriber(self.config)
            self.cloud_sync = CloudSync(self.config)
            
            # Initialize file monitor with callback
            self.file_monitor = FileMonitor(self.config, self.process_audio_file)
            
            self.logger.info("Audio Transcriber initialized successfully")
            
        except Exception as e:
            if self.logger:
                self.logger.error(f"Error initializing Audio Transcriber: {e}")
            else:
                print(f"Error initializing Audio Transcriber: {e}")
            raise
    
    def process_audio_file(self, audio_path: Path) -> bool:
        """
        Process a single audio file through the complete pipeline.
        
        Args:
            audio_path: Path to the audio file to process
            
        Returns:
            True if processing was successful, False otherwise
        """
        try:
            self.logger.info(f"Starting processing pipeline for: {audio_path}")
            
            # Step 1: Process audio file
            processed_audio_path = self.audio_processor.process_audio_file(audio_path)
            if processed_audio_path is None:
                self.logger.error(f"Failed to process audio file: {audio_path}")
                return False
            
            try:
                # Step 2: Transcribe audio
                transcription_data = self.transcriber.transcribe_audio(processed_audio_path)
                if transcription_data is None:
                    self.logger.error(f"Failed to transcribe audio file: {audio_path}")
                    return False
                
                # Step 3: Save transcript locally
                output_format = self.config.get('transcription', {}).get('output_format', 'txt')
                transcript_filename = f"{audio_path.stem}_transcript.{output_format}"
                transcript_path = Path.cwd() / transcript_filename
                
                if not self.transcriber.save_transcript(transcription_data, transcript_path):
                    self.logger.error(f"Failed to save transcript: {transcript_path}")
                    return False
                
                # Step 4: Save transcript to iCloud
                if not self.cloud_sync.save_transcript_to_icloud(transcript_path, audio_path):
                    self.logger.error(f"Failed to save transcript to iCloud: {audio_path}")
                    return False
                
                # Step 5: Get and log statistics
                stats = self.transcriber.get_transcription_stats(transcription_data)
                self.logger.info(f"Transcription completed successfully:")
                self.logger.info(f"  - Words: {stats.get('word_count', 0)}")
                self.logger.info(f"  - Characters: {stats.get('character_count', 0)}")
                self.logger.info(f"  - Language: {stats.get('language', 'unknown')}")
                self.logger.info(f"  - Model: {stats.get('model_used', 'unknown')}")
                
                # Clean up local transcript file
                try:
                    transcript_path.unlink()
                except Exception as e:
                    self.logger.warning(f"Could not clean up local transcript: {e}")
                
                return True
                
            finally:
                # Always clean up processed audio file
                self.audio_processor.cleanup_temp_file(processed_audio_path)
            
        except Exception as e:
            self.logger.error(f"Error in processing pipeline for {audio_path}: {e}")
            return False
    
    def start_monitoring(self) -> bool:
        """
        Start monitoring iCloud directory for new audio files.
        
        Returns:
            True if monitoring started successfully
        """
        try:
            # Ensure iCloud directories exist
            if not self.cloud_sync.ensure_directories_exist():
                return False
            
            # Get iCloud paths
            source_path, dest_path = get_icloud_paths(self.config)
            
            # Start file monitoring
            if not self.file_monitor.start_monitoring(source_path):
                return False
            
            self.is_running = True
            self.logger.info("Started monitoring iCloud directory for new audio files")
            self.logger.info(f"Source directory: {source_path}")
            self.logger.info(f"Destination directory: {dest_path}")
            
            return True
            
        except Exception as e:
            self.logger.error(f"Error starting monitoring: {e}")
            return False
    
    def stop_monitoring(self) -> None:
        """Stop monitoring for new audio files."""
        if self.file_monitor:
            self.file_monitor.stop_monitoring()
        self.is_running = False
        self.logger.info("Stopped monitoring")
    
    def process_existing_files(self) -> int:
        """
        Process all existing audio files in the iCloud directory.
        
        Returns:
            Number of files processed successfully
        """
        try:
            # Ensure iCloud directories exist
            if not self.cloud_sync.ensure_directories_exist():
                return 0
            
            # Get iCloud paths
            source_path, dest_path = get_icloud_paths(self.config)
            
            # Process existing files
            processed_files = self.file_monitor.process_existing_files(source_path, dest_path)
            
            self.logger.info(f"Processed {len(processed_files)} existing audio files")
            return len(processed_files)
            
        except Exception as e:
            self.logger.error(f"Error processing existing files: {e}")
            return 0
    
    def get_status(self) -> dict:
        """
        Get application status.
        
        Returns:
            Dictionary with status information
        """
        status = {
            'is_running': self.is_running,
            'config_loaded': bool(self.config),
            'components_initialized': all([
                self.audio_processor is not None,
                self.transcriber is not None,
                self.file_monitor is not None,
                self.cloud_sync is not None
            ])
        }
        
        # Add iCloud status
        if self.cloud_sync:
            status['icloud'] = self.cloud_sync.get_icloud_status()
        
        # Add file statistics
        if self.file_monitor:
            source_path, _ = get_icloud_paths(self.config)
            status['file_stats'] = self.file_monitor.get_file_stats(source_path)
        
        return status


def signal_handler(signum, frame):
    """Handle interrupt signals."""
    print("\nReceived interrupt signal. Shutting down gracefully...")
    if hasattr(signal_handler, 'app') and signal_handler.app:
        signal_handler.app.stop_monitoring()
    sys.exit(0)


@click.group()
@click.version_option(version="1.0.0")
def cli():
    """Audio Transcriber - Convert audio files to transcripts and sync to iCloud."""
    pass


@cli.command()
@click.option('--config', '-c', default='config/settings.yaml', help='Configuration file path')
@click.option('--monitor', '-m', is_flag=True, help='Start monitoring for new files')
@click.option('--process-existing', '-p', is_flag=True, help='Process existing audio files')
def start(config, monitor, process_existing):
    """Start the Audio Transcriber application."""
    try:
        # Initialize application
        app = AudioTranscriber(config)
        
        # Store app reference for signal handler
        signal_handler.app = app
        
        # Setup signal handlers
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        # Process existing files if requested
        if process_existing:
            click.echo("Processing existing audio files...")
            processed_count = app.process_existing_files()
            click.echo(f"Processed {processed_count} files")
            
            if not monitor:
                return
        
        # Start monitoring if requested
        if monitor:
            click.echo("Starting file monitoring...")
            if app.start_monitoring():
                click.echo("Monitoring started. Press Ctrl+C to stop.")
                try:
                    # Keep the application running
                    while app.is_running:
                        signal.pause()
                except KeyboardInterrupt:
                    pass
                finally:
                    app.stop_monitoring()
            else:
                click.echo("Failed to start monitoring", err=True)
                sys.exit(1)
        
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.option('--config', '-c', default='config/settings.yaml', help='Configuration file path')
def status(config):
    """Show application status."""
    try:
        app = AudioTranscriber(config)
        status_info = app.get_status()
        
        click.echo("Audio Transcriber Status:")
        click.echo(f"  Running: {status_info['is_running']}")
        click.echo(f"  Config loaded: {status_info['config_loaded']}")
        click.echo(f"  Components initialized: {status_info['components_initialized']}")
        
        if 'icloud' in status_info:
            icloud = status_info['icloud']
            click.echo("\niCloud Status:")
            click.echo(f"  Base path exists: {icloud['base_path_exists']}")
            click.echo(f"  Audio source exists: {icloud['audio_source_exists']}")
            click.echo(f"  Transcript dest exists: {icloud['transcript_dest_exists']}")
            click.echo(f"  Audio files: {icloud.get('audio_files_count', 0)}")
            click.echo(f"  Transcript files: {icloud.get('transcript_files_count', 0)}")
        
        if 'file_stats' in status_info:
            stats = status_info['file_stats']
            click.echo(f"\nFile Statistics:")
            click.echo(f"  Total audio files: {stats['total_files']}")
            click.echo(f"  Total size: {format_file_size(int(stats['total_size_mb'] * 1024 * 1024))}")
            if stats['formats']:
                click.echo(f"  Formats: {', '.join(f'{ext}: {count}' for ext, count in stats['formats'].items())}")
        
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.option('--config', '-c', default='config/settings.yaml', help='Configuration file path')
@click.option('--days', '-d', default=30, help='Remove transcripts older than N days')
def cleanup(config, days):
    """Clean up old transcript files."""
    try:
        app = AudioTranscriber(config)
        removed_count = app.cloud_sync.cleanup_old_transcripts(days)
        click.echo(f"Removed {removed_count} old transcript files")
        
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


if __name__ == '__main__':
    cli() 