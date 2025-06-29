# Audio Transcriber

A Python application that automatically converts audio files to text transcripts and syncs them to iCloud Drive for easy access on your iPhone.

## Features

- **Automatic Transcription**: Uses OpenAI Whisper for high-quality speech-to-text conversion
- **iCloud Integration**: Monitors iCloud Drive for new audio files and saves transcripts back to iCloud
- **Multiple Formats**: Supports MP3, M4A, WAV, FLAC, AAC, MOV, M4V, **AIFF, AIF** files
- **Real-time Monitoring**: Watches for new audio files and processes them automatically
- **Batch Processing**: Process all existing audio files in a directory
- **Flexible Output**: Generate transcripts in TXT, JSON, or SRT formats
- **Smart Organization**: Preserves folder structure when saving transcripts

## Requirements

- macOS with iCloud Drive enabled
- Python 3.9 or higher
- FFmpeg (for audio processing)
- iCloud Drive synced to local machine

## Installation

### 1. Clone or Download the Project

```bash
git clone <repository-url>
cd audio-transcriber
```

### 2. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 3. Install FFmpeg

FFmpeg is required for audio processing. Install it using Homebrew:

```bash
brew install ffmpeg
```

Or download from [FFmpeg official website](https://ffmpeg.org/download.html).

### 4. Configure iCloud Paths

Edit `config/settings.yaml` to match your iCloud Drive setup:

```yaml
icloud:
  base_path: "~/Library/Mobile Documents/com~apple~CloudDocs"
  audio_source: "Audio Files"  # Your audio files folder
  transcript_dest: "Transcripts"  # Where transcripts will be saved
```

## Usage

### Command Line Interface

The application provides a command-line interface with several options:

#### Start Monitoring (Real-time)

```bash
python -m src.main start --monitor
```

This will:
- Monitor your iCloud audio directory for new files
- Automatically transcribe new audio files
- Save transcripts to iCloud
- Continue running until you press Ctrl+C

#### Process Existing Files

```bash
python -m src.main start --process-existing
```

This will:
- Find all existing audio files in your iCloud directory
- Transcribe them in batch
- Save transcripts to iCloud
- Exit when complete

#### Monitor and Process Existing Files

```bash
python -m src.main start --monitor --process-existing
```

This combines both modes - processes existing files first, then starts monitoring.

#### Check Status

```bash
python -m src.main status
```

Shows:
- Application status
- iCloud directory status
- File statistics
- Component initialization status

#### Clean Up Old Transcripts

```bash
python -m src.main cleanup --days 30
```

Removes transcript files older than the specified number of days.

### Creating a Test Audio File (macOS)

You can use the built-in `say` command to generate a test audio file:

```bash
echo "This is a test audio file for transcription. Hello world, this is a sample audio recording." | say -o ~/Library/Mobile\ Documents/com~apple~CloudDocs/Audio\ Files/test_audio.aiff
```

### Configuration Options

Edit `config/settings.yaml` to customize behavior:

#### Audio Processing
```yaml
audio:
  supported_formats: [".mp3", ".m4a", ".wav", ".flac", ".aac", ".mov", ".m4v", ".aiff", ".aif"]
  max_file_size_mb: 500
  preprocessing:
    target_sample_rate: 16000
    convert_to_mono: true
    normalize: true
```

#### Transcription Settings
```yaml
transcription:
  model_size: "base"  # tiny, base, small, medium, large
  language: "auto"    # auto-detect or specific language code
  include_timestamps: false
  output_format: "txt"  # txt, json, srt
  task: "transcribe"    # transcribe or translate
```

#### Monitoring
```yaml
monitoring:
  enabled: true
  check_interval: 60
  batch_size: 5
  skip_existing: true
```

## Directory Structure

The application expects this structure in your iCloud Drive:

```
iCloud Drive/
├── Audio Files/          # Your audio files go here
│   ├── meeting1.mp3
│   ├── interview.m4a
│   └── podcast/
│       └── episode1.wav
└── Transcripts/          # Transcripts are saved here
    ├── meeting1_transcript.txt
    ├── interview_transcript.txt
    └── podcast/
        └── episode1_transcript.txt
```

## Output Formats

### Plain Text (.txt)
Simple text format with just the transcribed content.

### JSON (.json)
Structured format with metadata:
```json
{
  "audio_file": "/path/to/audio.mp3",
  "text": "Transcribed text content...",
  "language": "en",
  "segments": [...],
  "metadata": {
    "model_size": "base",
    "task": "transcribe"
  }
}
```

### SRT (.srt)
Subtitle format with timestamps:
```
1
00:00:00,000 --> 00:00:03,500
Hello, this is the first segment.

2
00:00:03,500 --> 00:00:07,200
This is the second segment.
```

## Troubleshooting

### Common Issues

#### 1. iCloud Path Not Found
**Error**: "iCloud base path does not exist"

**Solution**: 
- Ensure iCloud Drive is enabled in System Preferences
- Check that the path in `config/settings.yaml` matches your system
- Default path: `~/Library/Mobile Documents/com~apple~CloudDocs`

#### 2. FFmpeg Not Found
**Error**: "Could not decode audio file"

**Solution**:
```bash
brew install ffmpeg
```

#### 3. Whisper Model Download Issues
**Error**: "Error loading Whisper model"

**Solution**:
- Check internet connection
- Try a smaller model size (tiny, base)
- Clear Whisper cache: `rm -rf ~/.cache/whisper`

#### 4. Permission Issues
**Error**: "Permission denied"

**Solution**:
- Ensure the application has access to iCloud Drive
- Check file permissions on audio files
- Run with appropriate user permissions

#### 5. Large File Processing
**Error**: "File is too large"

**Solution**:
- Increase `max_file_size_mb` in configuration
- Consider splitting large audio files
- Use a smaller Whisper model for faster processing

#### 6. Audio Format Not Supported
**Error**: "No audio files found in source directory" or file is ignored

**Solution**:
- Make sure your audio file extension is listed in `supported_formats` in `config/settings.yaml`
- Supported formats: `.mp3`, `.m4a`, `.wav`, `.flac`, `.aac`, `.mov`, `.m4v`, `.aiff`, `.aif`
- For macOS, use `.aiff` or `.aif` with the `say` command

### Performance Tips

1. **Model Size**: Use smaller models (tiny, base) for faster processing
2. **Batch Processing**: Process files in batches rather than one at a time
3. **File Organization**: Keep audio files organized in subdirectories
4. **Regular Cleanup**: Use the cleanup command to remove old transcripts

### Logging

The application creates detailed logs. Check the log file specified in your configuration:

```yaml
logging:
  level: "INFO"
  file: "transcriber.log"
```

## Development

### Project Structure
```
audio-transcriber/
├── src/
│   ├── __init__.py
│   ├── main.py              # Main entry point and CLI
│   ├── audio_processor.py   # Audio file processing
│   ├── transcriber.py       # Speech-to-text conversion
│   ├── file_monitor.py      # File system monitoring
│   ├── cloud_sync.py        # iCloud integration
│   └── utils.py             # Utility functions
├── config/
│   └── settings.yaml        # Configuration file
├── requirements.txt         # Python dependencies
└── README.md               # This file
```

### Adding New Features

1. **New Audio Formats**: Add extensions to `supported_formats` in config
2. **Custom Output Formats**: Extend the `Transcriber` class
3. **Additional Cloud Storage**: Implement new sync providers in `cloud_sync.py`

## License

This project is open source. Please check the license file for details.

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the logs for detailed error information
3. Ensure all dependencies are properly installed
4. Verify iCloud Drive configuration

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request 