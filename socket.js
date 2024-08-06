const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const sharp = require("sharp");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const port = 3000;

// Create HTTP server
const server = http.createServer(app);
const io = socketIo(server);

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// AWS S3 setup
const s3 = new AWS.S3({
  accessKeyId: "AKIA6ODU4JONEYXSLBWA",
  secretAccessKey: "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",
  region: "us-west-2",
});

const bucketName = "907-navigator-dev";

// Helper function to convert images to WebP
const convertImageToWebp = async (imageInBuffer) => {
  return sharp(imageInBuffer).webp({ quality: 50 }).toBuffer();
};

// Upload files to S3
const uploadToS3 = (files, socketId) => {
  return new Promise((resolve, reject) => {
    let uploadResults = [];
    let totalFiles = files.length;
    let completedFiles = 0;

    files.forEach((file, index) => {
      const ext = path.extname(file.originalname);
      let fileName = `${file.fieldname}-${Date.now().toString()}${ext}`;

      const params = {
        Bucket: bucketName,
        Key: `${file.fieldname}/${fileName}`,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      const upload = s3.upload(params);
      upload.on("httpUploadProgress", (progress) => {
        const percentage = Math.round((progress.loaded / progress.total) * 100);
        console.log(`File: ${fileName} - ${percentage}% uploaded`);

        // Send progress updates to the client
        io.to(socketId).emit("uploadProgress", {
          file: fileName,
          percentage: percentage,
        });
      });

      upload.send((err, data) => {
        if (err) {
          console.log(`Error uploading ${fileName}:`, err);
          uploadResults[index] = {
            file: fileName,
            status: "error",
            error: err,
          };
        } else {
          console.log(`Successfully uploaded ${fileName}`);
          uploadResults[index] = {
            file: fileName,
            status: "success",
            location: data.Location,
          };
        }
        completedFiles++;
        if (completedFiles === totalFiles) {
          resolve(uploadResults);
        }
      });
    });
  });
};

// POST endpoint for file uploads
app.post("/upload", upload.array("media_h", 10), async (req, res) => {
  try {
    let files = req.files;
    let webpFilesArray = [];

    for (let file of files) {
      let mime_type = file.mimetype.split("/")[0];
      if (mime_type === "image" && !file.originalname.endsWith(".psd")) {
        let imageNewBuffer = await convertImageToWebp(file.buffer);
        if (imageNewBuffer) {
          webpFilesArray.push({
            fieldname: file.fieldname,
            originalname: `${file.originalname}.webp`,
            encoding: file.encoding,
            mimetype: file.mimetype,
            buffer: imageNewBuffer,
            size: file.size,
          });
        }
      } else {
        webpFilesArray.push(file);
      }
    }

    const socketId = req.headers["socket-id"];
    res.json({ success: true, message: "Upload in progress" });

    const uploadResults = await uploadToS3(webpFilesArray, socketId);
    io.to(socketId).emit("uploadComplete", {
      success: true,
      message: "Files uploaded",
      data: uploadResults,
    });
  } catch (err) {
    console.log(`Error in upload:`, err);
    res
      .status(500)
      .json({ success: false, message: "File upload failed", error: err });
  }
});

// Handle WebSocket connections
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
