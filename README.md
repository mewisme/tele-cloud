# Tele-Cloud: File Storage via Telegram

Tele-Cloud is a modern Node.js file server that utilizes Telegram as a storage backend, enabling you to host large files without traditional storage limitations. By chunking files and leveraging Telegram's reliable infrastructure, this solution provides a cost-effective way to serve files of virtually any size.

<p align="center">
  <img src="https://img.shields.io/badge/node.js-18.x-brightgreen" alt="Node.js Version">
  <img src="https://img.shields.io/badge/platform-docker%20%7C%20native-blue" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="License">
</p>

## ✨ Features

- **Chunked Uploads**: Break large files into manageable pieces
- **Resumable Transfers**: Continue uploads from where they left off
- **Range Requests**: Support for partial content downloads
- **Streaming**: Efficient file streaming directly to clients
- **Secure Deletion**: Token-based authorization for file removal
- **Overwrite Protection**: Safeguards against accidental file overwrites
- **Docker Support**: Easy deployment with Docker and docker-compose
- **Detailed Logging**: Comprehensive, color-coded console logging
- **Health Monitoring**: Built-in endpoint for uptime verification
- **Minimal Dependencies**: Lightweight codebase with few external packages

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ or Docker
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Telegram Chat ID (can be your user ID, a group, or channel)

### Environment Setup

Create a `.env` file in the project root:

```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
PORT=3000  # Optional
```

### Installation Options

#### Option 1: Traditional Setup

```bash
# Clone the repository
git clone https://github.com/mewisme/tele-cloud.git
cd tele-cloud

# Install dependencies
npm install

# Start the server
npm start
```

#### Option 2: Docker Deployment

```bash
# Clone the repository
git clone https://github.com/mewisme/tele-cloud.git
cd tele-cloud

# Start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f
```

## 📡 API Reference

### Health Check
```http
GET /health
```
Returns server status information and uptime.

### Upload File
```http
POST /u
```

**Request Body (multipart/form-data)**:
| Field | Type | Description |
|-------|------|-------------|
| `chunk` | File | Binary chunk data |
| `fileId` | String | Unique file identifier |
| `fileName` | String | Original filename |
| `fileSize` | Number | Total file size in bytes |
| `chunkIndex` | Number | Current chunk index (0-based) |
| `totalChunks` | Number | Total number of chunks |

**Final Chunk Response**:
```json
{
  "message": "File uploaded successfully",
  "fileId": "abc123",
  "done": true,
  "fileName": "example.pdf",
  "totalChunks": 10,
  "deleteToken": "f58a09b27c5e9d3e4c6f..."
}
```

### Download File
```http
GET /:fileId
```
Downloads the file with the specified ID. Supports range headers for partial content.

### Delete File
```http
DELETE /:fileId
```

**Request Body (application/json)**:
```json
{
  "token": "f58a09b27c5e9d3e4c6f..."
}
```

## 🔧 Technical Details

### Architecture Overview

1. **Upload Process**:
   - Client divides file into 10MB chunks
   - Server stores each chunk on Telegram
   - File metadata and chunk IDs are stored locally
   - Unique deletion token is generated on completion

2. **Download Process**:
   - Server retrieves file metadata by ID
   - Telegram file URLs are generated for each chunk
   - Chunks are streamed sequentially to the client
   - Range requests are supported for partial downloads

3. **Deletion Process**:
   - Client provides file ID and deletion token
   - Server verifies token against stored metadata
   - Metadata is removed upon successful verification

### Security Considerations

- **Access Control**: Files are accessible only with the correct file ID
- **Deletion Protection**: Files can only be deleted with a unique token
- **Overwrite Prevention**: Completed files cannot be overwritten
- **No Direct Storage Access**: Files are stored in Telegram's secure infrastructure

### Docker Deployment

The included Docker configuration offers:

- Automatic container restart
- Volume mapping for persistent metadata
- Health checks to monitor application status
- Environment variable configuration via `.env` file
- Alpine-based image for minimal footprint

## 📝 Client Implementation Examples

### JavaScript Upload Example

```javascript
async function uploadFile(file) {
  const chunkSize = 50 * 1024 * 1024; // 10MB
  const fileId = generateRandomId();
  const totalChunks = Math.ceil(file.size / chunkSize);
  let deleteToken = null;
  
  for (let i = 0; i < totalChunks; i++) {
    const chunk = file.slice(i * chunkSize, (i + 1) * chunkSize);
    const formData = new FormData();
    
    formData.append('chunk', chunk);
    formData.append('fileId', fileId);
    formData.append('fileName', file.name);
    formData.append('fileSize', file.size);
    formData.append('chunkIndex', i);
    formData.append('totalChunks', totalChunks);
    
    const response = await fetch('http://localhost:3000/u', {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    console.log(`Uploaded chunk ${i+1}/${totalChunks}`);
    
    // Save delete token from the final chunk response
    if (result.done && result.deleteToken) {
      deleteToken = result.deleteToken;
    }
  }
  
  return { fileId, deleteToken };
}

function generateRandomId() {
  return Math.random().toString(36).substring(2, 10);
}
```

### JavaScript Delete Example

```javascript
async function deleteFile(fileId, deleteToken) {
  const response = await fetch(`http://localhost:3000/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token: deleteToken })
  });
  
  const result = await response.json();
  return result;
}
```

## ⚠️ Limitations

- Maximum chunk size is 50MB (Telegram Bot API limit)
- Default chunk size is set to 10MB
- Metadata is stored locally, not on Telegram
- No built-in authentication for uploads/downloads
- Telegram rate limits may apply for heavy usage

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👏 Acknowledgments

- Built on Telegram's Bot API for reliable storage
- Inspired by the need for simple, scalable file hosting solutions without infrastructure costs
