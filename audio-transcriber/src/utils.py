"""
Utility functions for the Audio Transcriber package.
"""

import os
import yaml
import logging
from pathlib import Path
from typing import Dict, Any, Optional
import click


def load_config(config_path: str = "config/settings.yaml") -> Dict[str, Any]:
    """
    Load configuration from YAML file.
    
    Args:
        config_path: Path to the configuration file
        
    Returns:
        Dictionary containing configuration settings
    """
    try:
        with open(config_path, 'r') as file:
            config = yaml.safe_load(file)
        
        # Expand user paths
        if 'icloud' in config:
            config['icloud']['base_path'] = os.path.expanduser(config['icloud']['base_path'])
        
        return config
    except FileNotFoundError:
        click.echo(f"Configuration file not found: {config_path}")
        return {}
    except yaml.YAMLError as e:
        click.echo(f"Error parsing configuration file: {e}")
        return {}


def setup_logging(config: Dict[str, Any]) -> logging.Logger:
    """
    Set up logging based on configuration.
    
    Args:
        config: Configuration dictionary
        
    Returns:
        Configured logger instance
    """
    log_config = config.get('logging', {})
    log_level = getattr(logging, log_config.get('level', 'INFO'))
    
    # Create logger
    logger = logging.getLogger('audio_transcriber')
    logger.setLevel(log_level)
    
    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Create console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # Create file handler if specified
    log_file = log_config.get('file')
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger


def get_icloud_paths(config: Dict[str, Any]) -> tuple[Path, Path]:
    """
    Get iCloud source and destination paths.
    
    Args:
        config: Configuration dictionary
        
    Returns:
        Tuple of (source_path, dest_path)
    """
    icloud_config = config.get('icloud', {})
    base_path = Path(icloud_config.get('base_path', ''))
    
    source_path = base_path / icloud_config.get('audio_source', 'Audio Files')
    dest_path = base_path / icloud_config.get('transcript_dest', 'Transcripts')
    
    return source_path, dest_path


def ensure_directory_exists(path: Path) -> None:
    """
    Ensure a directory exists, create if it doesn't.
    
    Args:
        path: Directory path to create
    """
    path.mkdir(parents=True, exist_ok=True)


def is_audio_file(file_path: Path, supported_formats: list) -> bool:
    """
    Check if a file is a supported audio file.
    
    Args:
        file_path: Path to the file
        supported_formats: List of supported file extensions
        
    Returns:
        True if file is a supported audio format
    """
    return file_path.suffix.lower() in supported_formats


def get_transcript_filename(audio_file: Path, output_format: str = "txt") -> str:
    """
    Generate transcript filename from audio filename.
    
    Args:
        audio_file: Path to the audio file
        output_format: Output format extension
        
    Returns:
        Transcript filename
    """
    base_name = audio_file.stem
    return f"{base_name}_transcript.{output_format}"


def format_file_size(size_bytes: int) -> str:
    """
    Format file size in human readable format.
    
    Args:
        size_bytes: Size in bytes
        
    Returns:
        Formatted size string
    """
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


def validate_config(config: Dict[str, Any]) -> bool:
    """
    Validate configuration settings.
    
    Args:
        config: Configuration dictionary
        
    Returns:
        True if configuration is valid
    """
    required_sections = ['icloud', 'audio', 'transcription']
    
    for section in required_sections:
        if section not in config:
            click.echo(f"Missing required configuration section: {section}")
            return False
    
    # Check iCloud paths
    icloud_config = config['icloud']
    if not icloud_config.get('base_path'):
        click.echo("iCloud base path not configured")
        return False
    
    return True 