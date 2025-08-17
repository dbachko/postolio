# FFmpeg Lambda Layer

This layer provides FFmpeg and FFprobe binaries for AWS Lambda.

## Setup Instructions

1. Download the latest FFmpeg static builds for Linux (x86_64):
   ```bash
   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
   tar xf ffmpeg-release-amd64-static.tar.xz
   cp ffmpeg-*/ffmpeg bin/
   cp ffmpeg-*/ffprobe bin/
   chmod +x bin/*
   ```

2. Or use the AWS Lambda FFmpeg layer from:
   - https://github.com/serverlesspub/ffmpeg-aws-lambda-layer
   - https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:145266761615:applications~ffmpeg-lambda-layer

## Binary Requirements

The binaries must be:
- Compiled for Amazon Linux 2 (x86_64)
- Statically linked to avoid dependency issues
- Placed in the `bin/` directory
- Have execute permissions

## Layer Structure

```
ffmpeg/
├── bin/
│   ├── ffmpeg    # FFmpeg binary
│   └── ffprobe   # FFprobe binary
└── README.md
```

## Usage in Lambda

The layer adds `/opt/bin` to the PATH, making the binaries available as:
- `ffmpeg`
- `ffprobe`

Example in Node.js:
```javascript
const { execSync } = require('child_process');
const output = execSync('ffprobe -version');
```