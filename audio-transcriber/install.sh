#!/bin/bash

# Audio Transcriber Installation Script
# This script installs all dependencies and sets up the audio transcriber

set -e

echo "🎵 Audio Transcriber Installation Script"
echo "========================================"

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script is designed for macOS only."
    echo "Please install dependencies manually for your operating system."
    exit 1
fi

# Check Python version
echo "🔍 Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
required_version="3.9.0"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo "❌ Python 3.9 or higher is required. Found: $python_version"
    echo "Please install Python 3.9+ from https://www.python.org/downloads/"
    exit 1
fi

echo "✅ Python version: $python_version"

# Check if Homebrew is installed
echo "🔍 Checking for Homebrew..."
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew is not installed."
    echo "Please install Homebrew first: https://brew.sh/"
    exit 1
fi

echo "✅ Homebrew is installed"

# Install FFmpeg
echo "🔍 Checking for FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    echo "📦 Installing FFmpeg..."
    brew install ffmpeg
    echo "✅ FFmpeg installed"
else
    echo "✅ FFmpeg is already installed"
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
if [ -f "requirements.txt" ]; then
    pip3 install -r requirements.txt
    echo "✅ Python dependencies installed"
else
    echo "❌ requirements.txt not found"
    exit 1
fi

# Create iCloud directories if they don't exist
echo "📁 Setting up iCloud directories..."
icloud_base="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
audio_dir="$icloud_base/Audio Files"
transcript_dir="$icloud_base/Transcripts"

if [ ! -d "$icloud_base" ]; then
    echo "⚠️  iCloud Drive not found at: $icloud_base"
    echo "Please ensure iCloud Drive is enabled in System Preferences"
    echo "You may need to adjust the path in config/settings.yaml"
else
    echo "✅ iCloud Drive found"
    
    # Create audio directory
    if [ ! -d "$audio_dir" ]; then
        mkdir -p "$audio_dir"
        echo "✅ Created audio directory: $audio_dir"
    else
        echo "✅ Audio directory already exists: $audio_dir"
    fi
    
    # Create transcript directory
    if [ ! -d "$transcript_dir" ]; then
        mkdir -p "$transcript_dir"
        echo "✅ Created transcript directory: $transcript_dir"
    else
        echo "✅ Transcript directory already exists: $transcript_dir"
    fi
fi

# Test the installation
echo "🧪 Testing installation..."
if python3 -c "import whisper, pydub, watchdog, yaml, click" 2>/dev/null; then
    echo "✅ All Python dependencies are working"
else
    echo "❌ Some Python dependencies are missing"
    echo "Please run: pip3 install -r requirements.txt"
    exit 1
fi

# Test FFmpeg
if ffmpeg -version &> /dev/null; then
    echo "✅ FFmpeg is working"
else
    echo "❌ FFmpeg is not working properly"
    exit 1
fi

echo ""
echo "🎉 Installation completed successfully!"
echo ""
echo "Next steps:"
echo "1. Place your audio files in: $audio_dir"
echo "2. Run the transcriber:"
echo "   python3 -m src.main start --process-existing  # Process existing files"
echo "   python3 -m src.main start --monitor           # Monitor for new files"
echo "   python3 -m src.main status                    # Check status"
echo ""
echo "For more information, see README.md"
echo "" 