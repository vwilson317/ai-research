# Audio to Transcript Converter - Implementation Plan

## Overview
Create a Python program that automatically converts audio files from iCloud to text transcripts and saves them back to iCloud for viewing on iPhone.

## Requirements Analysis
- **Input**: Audio files stored in iCloud Drive
- **Output**: Text transcripts saved to iCloud Drive
- **Platform**: macOS
- **Accessibility**: View transcripts on iPhone via iCloud

## Technical Architecture

### 1. Core Components
- **Audio Processing**: Convert various audio formats to speech recognition compatible format
- **Speech Recognition**: Convert speech to text using OpenAI Whisper (high accuracy)
- **File Management**: Monitor iCloud directory for new audio files
- **Cloud Integration**: Save transcripts back to iCloud Drive

### 2. Technology Stack
- **Language**: Python 3.9+
- **Speech Recognition**: OpenAI Whisper (local or API)
- **Audio Processing**: pydub, ffmpeg
- **File Monitoring**: watchdog
- **Cloud Storage**: iCloud Drive (via local file system)
- **Configuration**: YAML for settings

### 3. Program Structure
```
audio-transcriber/
├── src/
│   ├── __init__.py
│   ├── main.py              # Main entry point
│   ├── audio_processor.py   # Audio file handling
│   ├── transcriber.py       # Speech-to-text conversion
│   ├── file_monitor.py      # iCloud directory monitoring
│   ├── cloud_sync.py        # iCloud file management
│   └── utils.py             # Utility functions
├── config/
│   └── settings.yaml        # Configuration file
├── requirements.txt         # Python dependencies
├── README.md               # Usage instructions
└── setup.py                # Installation script
```

## Implementation Steps

### Phase 1: Core Setup
1. **Project Structure**: Create directory structure and basic files
2. **Dependencies**: Set up requirements.txt with necessary packages
3. **Configuration**: Create YAML config for iCloud paths and settings
4. **Basic Audio Processing**: Implement audio file format conversion

### Phase 2: Speech Recognition
1. **Whisper Integration**: Set up OpenAI Whisper for transcription
2. **Audio Preprocessing**: Convert audio to optimal format for Whisper
3. **Transcription Logic**: Implement core speech-to-text functionality
4. **Error Handling**: Handle various audio formats and quality issues

### Phase 3: File Management
1. **iCloud Integration**: Set up monitoring of iCloud Drive directory
2. **File Detection**: Automatically detect new audio files
3. **Batch Processing**: Handle multiple files efficiently
4. **Output Management**: Save transcripts with proper naming

### Phase 4: Automation & Polish
1. **File Monitoring**: Implement real-time directory watching
2. **Progress Tracking**: Add logging and progress indicators
3. **Error Recovery**: Implement robust error handling
4. **User Interface**: Add command-line interface with options

## Key Features

### Audio Support
- **Formats**: MP3, M4A, WAV, FLAC, AAC, MOV (audio)
- **Quality**: Automatic audio preprocessing for optimal recognition
- **Batch Processing**: Handle multiple files simultaneously

### Transcription Quality
- **Engine**: OpenAI Whisper (high accuracy)
- **Language Detection**: Automatic language detection
- **Timestamps**: Optional timestamp inclusion
- **Speaker Detection**: Basic speaker diarization (if needed)

### File Management
- **Automatic Detection**: Watch iCloud directory for new files
- **Smart Naming**: Generate transcript filenames based on audio files
- **Organization**: Maintain folder structure in iCloud
- **Backup**: Keep original audio files intact

### User Experience
- **Command Line Interface**: Easy-to-use CLI
- **Configuration**: Simple YAML-based settings
- **Logging**: Detailed progress and error logging
- **Resume Capability**: Continue interrupted transcriptions

## Configuration Options
- **iCloud Paths**: Source and destination directories
- **Audio Formats**: Supported file types
- **Whisper Model**: Model size (tiny, base, small, medium, large)
- **Output Format**: Plain text, JSON, or SRT
- **Language**: Force specific language or auto-detect
- **Timestamps**: Include or exclude timestamps

## Installation Requirements
- Python 3.9+
- FFmpeg (for audio processing)
- OpenAI Whisper (local installation)
- iCloud Drive enabled and synced

## Usage Scenarios
1. **Real-time Monitoring**: Watch iCloud folder and transcribe new files automatically
2. **Batch Processing**: Process all existing audio files in a directory
3. **Single File**: Transcribe one specific audio file
4. **Scheduled**: Run on a schedule using cron or launchd

## Next Steps
1. Create project structure and basic files
2. Implement core audio processing functionality
3. Add Whisper integration for transcription
4. Build file monitoring and iCloud integration
5. Add user interface and error handling
6. Test with various audio formats and scenarios 