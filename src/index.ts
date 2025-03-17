/**
 * videoPipeline.ts
 *
 * Usage:
 *   ts-node videoPipeline.ts producer   // Runs the producer: downloads a YouTube video, uploads it to Fake S3, and produces a Kafka event.
 *   ts-node videoPipeline.ts consumer   // Runs the consumer: listens for events, downloads the video from Fake S3, encodes it into four formats, and uploads the results.
 */

import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Kafka, type EachMessagePayload } from "kafkajs";
import ffmpeg from "fluent-ffmpeg";

// ---------- Configuration ----------

// This storage directory emulates S3. The interface remains the same.
const storageDir: string = path.join(__dirname, "storage");
// Ensure the storage directory exists.
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const kafkaBrokers = ["kafka:9092"];
// const outputFormats: string[] = ["mp4", "avi", "webm", "mkv"];
const outputFormats: string[] = ["mp4", "avi"];
// ---------- "S3" Interface Implemented with the File System ----------

/**
 * "Uploads" a local file to our storage folder.
 * The s3Key is treated as the relative path inside the storageDir.
 */
function uploadToS3(localFilePath: string, s3Key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const destPath = path.join(storageDir, s3Key);
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFile(localFilePath, destPath, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`Copied ${localFilePath} to storage at ${destPath}`);
        resolve();
      }
    });
  });
}

/**
 * "Downloads" an object from our storage folder to a local path.
 */
function downloadFromS3(s3Key: string, localPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const srcPath = path.join(storageDir, s3Key);
    fs.copyFile(srcPath, localPath, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`Copied ${srcPath} to ${localPath}`);
        resolve(localPath);
      }
    });
  });
}

/**
 * Downloads a YouTube video using yt-dlp.
 */
function downloadYouTubeVideo(
  videoUrl: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    resolve(outputPath);
    // First, get the filename that yt-dlp will use
    // const getFilenameCommand = `yt-dlp --get-filename -f 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b' -o "${outputPath}.%(ext)s" ${videoUrl}`;
    // exec(getFilenameCommand, (error, stdout, stderr) => {
    //   if (error) {
    //     console.error(`Error getting filename: ${error.message}`);
    //     return reject(error);
    //   }

    //   const actualOutputPath = stdout.trim(); // Remove any trailing newlines
    //   const command = `yt-dlp -f 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b' -o "${outputPath}.%(ext)s" ${videoUrl}`;
    //   console.log(`Executing: ${command}`);

    // exec(command, (error, stdout) => {
    //   if (error) {
    //     console.error(`yt-dlp error: ${error.message}`);
    //     return reject(error);
    //   }
    //   console.log(`yt-dlp output: ${stdout}`);
    //   resolve(actualOutputPath);
    // });
    // });
  });
}

/**
 * Produces a Kafka event with the given S3 key.
 */
async function produceEvent(s3Key: string): Promise<void> {
  const kafka = new Kafka({
    brokers: kafkaBrokers,
    clientId: "yt-crawler-producer",
    retry: {
      retries: 20,
    },
  });
  const producer = kafka.producer();
  await producer.connect();
  const videoEvent = { s3Key };
  await producer.send({
    topic: "video-uploads-4",
    messages: [{ value: JSON.stringify(videoEvent) }],
  });
  console.log(`Produced event for video with storage key: ${s3Key}`);
  await producer.disconnect();
}

/**
 * Encodes a video file into the specified format using ffmpeg.
 */
function encodeVideo(inputPath: string, format: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const inputBasename = path.basename(inputPath, path.extname(inputPath));
    const outputDir = path.join(__dirname, "temp_encoded");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    console.log(`Started encoding to ${format}: ${inputPath}`);
    const outputPath = path.join(outputDir, `${inputBasename}.${format}`);
    ffmpeg(inputPath)
      .output(outputPath)
      .on("end", () => {
        console.log(`Finished encoding to ${format}: ${outputPath}`);
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.error(`Error encoding to ${format}:`, err);
        reject(err);
      })
      .run();
  });
}

// ---------- Producer Logic ----------

async function runProducer(): Promise<void> {
  // Replace VIDEO_ID with a valid YouTube video ID.

  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let ids = ["ywOhAvyA9Bk", "0YzMNYvpdxg", "dfgo43tgRGe", "342rweWEqfda"];
  for (let i = 0; i < 10; i++) {
    ids = ids.concat(ids).concat(ids).concat(ids).concat(ids).concat(ids);
  }
  for (let id of ids) {
    try {
      const outputFilename = `downloaded_video_${id}`;
      let localOutputPath = path.join(tempDir, outputFilename);
      const videoUrl = `https://www.youtube.com/watch?v=${id}`;
      console.log(`Downloading video from YouTube: ${videoUrl}`);
      localOutputPath = await downloadYouTubeVideo(videoUrl, localOutputPath);
      await new Promise((resolve) => {
        setTimeout(resolve, Math.random() * 1000);
      });
      console.log(`Downloaded video to: ${localOutputPath}`);

      // "Upload" the video to our storage folder.
      const s3Key = `videos/${outputFilename}`;
      // await uploadToS3(localOutputPath, s3Key);
      // console.log(`Stored video with key: ${s3Key}`);

      // Produce Kafka event.
      await produceEvent(s3Key);

      // Clean up local file.
      // fs.unlinkSync(localOutputPath);
    } catch (err) {
      console.error("Error in producer:", err);
    }
  }
}

// ---------- Consumer Logic ----------

async function processVideo(s3Key: string): Promise<void> {
  const tempDir = path.join(__dirname, "temp_encoded");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const localVideoPath = path.join(tempDir, path.basename(s3Key));

  // "Download" video from our storage folder.
  // await downloadFromS3(s3Key, localVideoPath);
  console.log(`Processing video from: ${localVideoPath}`);

  // Encode into each format.
  // const encodedPaths: Promise<string>[] = outputFormats.map((format) =>
  //   encodeVideo(localVideoPath, format)
  // );
  // const encodedFiles = await Promise.all(encodedPaths);

  // "Upload" each encoded file back to our storage folder.
  for (let i = 0; i < outputFormats.length; i++) {
    const format = outputFormats[i];
    // const encodedFile = encodedFiles[i];
    // const s3UploadKey = `encoded/${format}/${path.basename(encodedFile)}`;
    // await uploadToS3(encodedFile, s3UploadKey);
    console.log(`Stored ${format} for file with key: ${s3Key}`);
    // fs.unlinkSync(encodedFile);
  }
  // fs.unlinkSync(localVideoPath);
}

async function runConsumer(): Promise<void> {
  const kafka = new Kafka({ brokers: kafkaBrokers });
  const consumer = kafka.consumer({ groupId: "video-transcoder-4" });
  await consumer.connect();
  await consumer.subscribe({ topic: "video-uploads-4", fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload) => {
      try {
        const event = JSON.parse(message.value?.toString() || "{}");
        const s3Key: string = event.s3Key;
        console.log(`Received event for video with storage key: ${s3Key}`);
        await processVideo(s3Key);
        console.log(`Successfully processed video with storage key: ${s3Key}`);
      } catch (err) {
        console.error("Error processing video:", err);
      }
    },
  });
}

// ---------- Main Entry Point ----------

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    console.error("Please specify mode: producer or consumer");
    process.exit(1);
  }
  if (mode === "producer") {
    await runProducer();
  } else if (mode === "consumer") {
    await runConsumer();
  } else {
    console.error('Unknown mode. Use "producer" or "consumer".');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
});
