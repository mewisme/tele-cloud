import 'dotenv/config';

import { Readable, Transform } from "stream";

import FormData from 'form-data';
import axios from "axios";
import chalk from 'chalk';
import cors from "cors";
import express from "express";
import { fileURLToPath } from 'url';
import fs from 'fs';
import mime from 'mime-types';
import multer from 'multer';
import path from "path";
import { randomBytes } from 'crypto';

// Setup constants
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METADATA_DIR = path.join(__dirname, 'metadata');

// ============ LOGGER UTILITY ============
const logger = {
  formatTime() {
    const date = new Date();
    return date.toTimeString().split(' ')[0];
  },

  formatResponseTime(time) {
    const seconds = time[0];
    const nanoseconds = time[1];

    if (seconds === 0 && nanoseconds < 1000) {
      return `${nanoseconds}µs`;
    } else if (seconds === 0) {
      return `${(nanoseconds / 1000000).toFixed(1)}ms`;
    } else {
      return `${(seconds + nanoseconds / 1e9).toFixed(1)}s`;
    }
  },

  formatLogLevel(level, color) {
    // Define the longest log level
    const longestLevel = 'KEEPALIVE';

    // Calculate padding based on the difference between longest and current level
    const padding = ' '.repeat(longestLevel.length - level.length + 1); // +1 for extra space

    return color(`${chalk.gray.underline(this.formatTime())} | ${level}${padding}`);
  },

  colorMethod(method) {
    switch (method.toUpperCase()) {
      case 'GET': return chalk.green
      case 'POST': return chalk.blueBright
      case 'PUT': return chalk.yellow
      case 'DELETE': return chalk.red
      case 'PATCH': return chalk.magentaBright
      case 'HEAD': return chalk.cyan
      case 'OPTIONS': return chalk.gray
      default: return chalk.white
    }
  },

  colorStatus(status) {
    if (status >= 500) return chalk.red(status);
    if (status >= 400) return chalk.yellow(status);
    if (status >= 300) return chalk.cyan(status);
    if (status >= 200) return chalk.green(status);
    return chalk.gray(status);
  },

  info(...args) {
    console.log(this.formatLogLevel('INFO', chalk.cyan), ...args);
  },

  success(...args) {
    console.log(this.formatLogLevel('SUCCESS', chalk.green), ...args);
  },

  warning(...args) {
    console.log(this.formatLogLevel('WARNING', chalk.yellow), ...args);
  },

  error(...args) {
    console.log(this.formatLogLevel('ERROR', chalk.red), ...args);
  },

  debug(...args) {
    console.log(this.formatLogLevel('DEBUG', chalk.gray), ...args);
  },

  progress(fileId, chunkIndex, totalChunks) {

    const progressPercent = (
      ((totalChunks === 1 ? 1 : chunkIndex) /
        (totalChunks === 1 ? totalChunks : (totalChunks - 1)))
      * 100
    ).toFixed(2);

    this.info(
      chalk.white(`File ID: ${chalk.cyan(fileId)}`) +
      chalk.white(` | Progress: ${chalk.yellow(`${chunkIndex + 1}/${totalChunks}`)}`) +
      chalk.white(` | ${chalk.green(progressPercent + '%')}`)
    )
  },

  request(method, url, statusCode, responseTime, ip, errorMessage = '') {
    const status = this.colorStatus(statusCode);
    const formattedIp = chalk.gray(ip || '').padStart(15);
    const formattedTime = chalk.cyan(responseTime);
    const formattedError = errorMessage ? chalk.red(` | ${errorMessage}`) : '';

    console.log(`${this.formatLogLevel(method, this.colorMethod(method))} ${formattedTime} | ${status} | ${formattedIp} | ${url}${formattedError}`);
  },

  keepalive(uptime) {
    console.log(
      this.formatLogLevel('KEEPALIVE', chalk.magenta) +
      chalk.cyan(' Server running for ') +
      chalk.yellow(uptime.toFixed(2)) +
      chalk.cyan(' minutes')
    );
  }
};

// Check required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  logger.error('Missing required environment variables.');
  logger.warning('Please create a .env file with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
  process.exit(1);
}

// Ensure metadata directory exists
if (!fs.existsSync(METADATA_DIR)) {
  fs.mkdirSync(METADATA_DIR, { recursive: true });
}

// Setup Express app
const app = express();
app.enable("trust proxy");
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger Middleware
app.use((req, res, next) => {
  const start = process.hrtime();

  // Save the original end method
  const originalEnd = res.end;

  // Override the end method
  res.end = function (...args) {
    const diff = process.hrtime(start);
    const responseTime = logger.formatResponseTime(diff);
    const ip = req.ip || req.connection.remoteAddress;
    const method = req.method;
    const url = req.originalUrl || req.url;
    const statusCode = res.statusCode;
    const errorMessage = res.statusCode >= 400 ? res.statusMessage || '' : '';

    logger.request(method, url, statusCode, responseTime, ip, errorMessage);

    return originalEnd.apply(this, args);
  };

  next();
});

// Setup axios client
const client = axios.create({ timeout: 30000 }); // 30 seconds timeout

// Add a keepalive interval to prevent server from closing
setInterval(() => {
  logger.keepalive(process.uptime() / 60);
}, 5 * 60 * 1000); // Log every 5 minutes

// Utility functions
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateDeleteToken = () => {
  return randomBytes(24).toString('hex');
};

const formatFileName = (filename, isChunk = false, chunkIndex = 0) => {
  const splitted = filename.split(".");
  const extension = splitted.pop() || "";
  const name = splitted.join(".");

  // Remove special characters, keep only letters, numbers, spaces and hyphens
  const cleaned = name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove Vietnamese accents
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim();

  // Convert to kebab-case
  const kebab = cleaned
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return `${kebab}${isChunk ? `-${chunkIndex}` : ''}.${extension}`;
};

async function uploadToService(file, fileName) {
  const stream = Readable.from(file.buffer);
  const form = new FormData();
  form.append('chat_id', process.env.TELEGRAM_CHAT_ID);
  form.append('document', stream, { filename: fileName });

  const config = {
    method: 'POST',
    url: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    data: form,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  };

  await wait(1500);

  try {
    const result = await client(config);
    return result.data.result.document.file_id;
  } catch (error) {
    if (error.response?.data?.parameters?.retry_after) {
      logger.warning('Rate limited. Waiting for', error.response.data.parameters.retry_after, 'seconds');
      await wait(error.response.data.parameters.retry_after * 1000);
      return await uploadToService(file, fileName);
    }
    throw error;
  }
}

async function getFileFromService(fileId) {
  try {
    const result = await client({
      method: 'GET',
      url: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile`,
      params: { file_id: fileId }
    });

    if (!result?.data?.ok) return null;
    return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${result.data.result.file_path}`;
  } catch (error) {
    logger.error('Error getting file from service:', error);
    return null;
  }
}

async function convertFileIdsToUrls(fileIds) {
  const urls = await Promise.all(fileIds.map(getFileFromService));
  return urls.filter(Boolean); // Remove any null values
}

// Stream processor for handling chunks
class AsyncStreamProcessor extends Transform {
  constructor(chunkProcessor) {
    super();
    this.chunkProcessor = chunkProcessor;
  }

  _transform(chunk, _, callback) {
    this.chunkProcessor(chunk)
      .then(() => callback(null))
      .catch(callback);
  }
}

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "File Server API"
  });
});

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

app.post("/u", multer().single("chunk"), async (req, res) => {
  try {
    const chunk = req.file;
    let { fileId, fileName, fileSize, chunkIndex, chunkSize, totalChunks } = req.body;

    if (!chunk || !fileId || !fileName || !fileSize || !chunkIndex || !chunkSize || !totalChunks) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    chunkIndex = parseInt(chunkIndex, 10);
    chunkSize = parseInt(chunkSize, 10);
    totalChunks = parseInt(totalChunks, 10);
    fileSize = parseInt(fileSize, 10);

    if (chunkSize < 1024 * 1024 || chunkSize > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'Chunk size must be between 1MB and 50MB', chunk_size: chunkSize, chunk_size_in_bytes: chunkSize * 1024 * 1024 });
    }

    const metadataFilePath = path.join(METADATA_DIR, `${fileId}.json`);

    // Check if a file with this ID already exists and is completed
    if (fs.existsSync(metadataFilePath)) {
      const existingMetadata = JSON.parse(fs.readFileSync(metadataFilePath, 'utf8'));
      if (existingMetadata.done === true) {
        logger.warning(`Attempted upload with existing fileId: ${fileId} that is already completed`);
        return res.status(409).json({
          error: 'A file with this ID already exists and is fully uploaded',
          fileId
        });
      }
    } else {
      // Create new metadata file if it doesn't exist
      fs.writeFileSync(metadataFilePath, JSON.stringify({
        done: false,
        fileId,
        fileName: formatFileName(fileName, false),
        fileSize,
        chunkSize,
        totalChunks,
        deleteToken: null,
        fileIds: [],
      }));
    }

    const metadataFile = fs.readFileSync(metadataFilePath, 'utf8');
    const metadata = JSON.parse(metadataFile);

    // Log progress with formatted logger
    logger.progress(fileId, chunkIndex, totalChunks);

    const fileUploadedId = await uploadToService(chunk, formatFileName(fileName, true, chunkIndex));
    metadata.fileIds.push(fileUploadedId);

    if (chunkIndex === totalChunks - 1) {
      metadata.done = true;
      metadata.deleteToken = generateDeleteToken();
    }

    fs.writeFileSync(metadataFilePath, JSON.stringify(metadata));

    if (chunkIndex === totalChunks - 1) {
      return res.json({
        message: 'File uploaded successfully',
        fileId,
        done: true,
        fileName: metadata.fileName,
        totalChunks: metadata.totalChunks,
        deleteToken: metadata.deleteToken
      });
    } else {
      return res.json({
        message: 'Chunk uploaded successfully',
        fileId,
        done: false,
        fileName: metadata.fileName,
        chunkIndex: chunkIndex + 1,
        totalChunks: metadata.totalChunks,
      });
    }
  } catch (error) {
    logger.error('Error uploading chunk:', error);
    return res.status(500).json({ message: 'Failed to upload chunk', error: error.message });
  }
});

// Delete file route
app.delete("/:fileId", async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Missing delete token' });
    }

    const metadataFilePath = path.join(METADATA_DIR, `${fileId}.json`);
    if (!fs.existsSync(metadataFilePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const metadataFile = fs.readFileSync(metadataFilePath, 'utf8');
    const metadata = JSON.parse(metadataFile);

    if (!metadata.deleteToken) {
      return res.status(400).json({ error: 'This file cannot be deleted' });
    }

    if (metadata.deleteToken !== token) {
      return res.status(403).json({ error: 'Invalid delete token' });
    }

    // Delete the metadata file
    fs.unlinkSync(metadataFilePath);

    logger.info(`File ${fileId} deleted successfully`);
    return res.json({
      message: 'File deleted successfully',
      fileId
    });
  } catch (error) {
    logger.error('Error deleting file:', error);
    return res.status(500).json({
      message: 'Failed to delete file',
      error: error.message
    });
  }
});

app.get("/:fileId", async (req, res) => {
  try {
    const fileId = req.params.fileId;

    const metadataFilePath = path.join(METADATA_DIR, `${fileId}.json`);
    if (!fs.existsSync(metadataFilePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const metadataFile = fs.readFileSync(metadataFilePath, 'utf8');
    const metadata = JSON.parse(metadataFile);

    res.setHeader("Content-Length", metadata.fileSize);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", `attachment; filename="${metadata.fileName}"`);
    res.contentType(mime.lookup(metadata.fileName) || 'application/octet-stream');

    logger.info('Start downloading all chunks...');

    const urls = await convertFileIdsToUrls(metadata.fileIds);

    const rangeStr = req.headers.range;
    const start = rangeStr ? parseInt(rangeStr.split("=")[1].split("-")[0], 10) : null;
    const end = rangeStr && start !== null ?
      Math.min(start + metadata.chunkSize, metadata.fileSize - 1) :
      null;

    const partsToDownload = (() => {
      if (!rangeStr || start === null || end === null) {
        return urls.map((url) => ({ url }));
      }

      const startPartNumber = Math.floor(start / metadata.chunkSize);
      const endPartNumber = Math.ceil(end / metadata.chunkSize);
      const parts = urls.slice(startPartNumber, endPartNumber)
        .map((url) => ({ url }));

      if (parts.length > 0) {
        parts[0].start = start % metadata.chunkSize;
        parts[parts.length - 1].end = end % metadata.chunkSize;
      }

      res.status(206);
      res.setHeader("Content-Length", end - start + 1);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${metadata.fileSize}`);
      return parts;
    })();

    for (const part of partsToDownload) {
      const headers = {};
      if (part.start !== undefined || part.end !== undefined) {
        headers.Range = `bytes=${part.start || 0}-${part.end !== undefined ? part.end : ''}`;
      }

      const response = await axios.get(part.url, {
        headers,
        responseType: "stream"
      });

      await new Promise((resolve, reject) => {
        response.data.pipe(new AsyncStreamProcessor(async (data) => {
          if (!res.write(data)) await new Promise((r) => res.once("drain", r));
        }));
        response.data.on("error", reject);
        response.data.on("end", resolve);
      });
    }

    res.end();
  } catch (error) {
    logger.error('Error downloading file:', error);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Internal server error",
        error: error.message
      });
    }
  }
});

// Start server
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  logger.success('Server is running on url', `http://localhost:${port}`);
  logger.info('Environment detected:', process.env.NODE_ENV || 'development');
  logger.info('Press Ctrl+C to stop the server');
});

// Add proper server error handling
server.on('error', (err) => {
  logger.error('Server error:', err);
});

// Error handling
process.on('uncaughtException', (err) => {
  logger.error('There was an uncaught error', err);
});

process.on('unhandledRejection', (err) => {
  logger.error('There was an unhandled rejection', err);
}); 