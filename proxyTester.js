import fs from "fs";
import ytdl from "ytdl-core";
import pLimit from "p-limit";
import minimist from "minimist";
import {HttpsProxyAgent} from "https-proxy-agent";

// const ytdl = require('ytdl-core');
// Configurable constants
const TIMEOUT_MS = 6000; // Timeout for each proxy test

// Helper: Read cookies safely
function readCookies(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Error reading cookies file: ${error.message}`);
  }
}

// Helper: Validate proxy format
const isValidProxy = (proxy) => {
  const [host, port] = proxy.split(":");
  return host && port && !isNaN(+port);
};

// Function to read proxies from a file
async function readProxiesFromFile(filePath) {
  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    return data
      .split("\n")
      .map((line) => line.trim())
      .filter(isValidProxy);
  } catch (error) {
    throw new Error(`Error reading proxies file: ${error.message}`);
  }
}

// Function to test a single proxy
// Function to test a single proxy
async function testProxy(proxy, videoUrl, formatType, quality, cookies) {
  const proxyUrl = proxy.startsWith("http") ? proxy : `http://${proxy}`;
  // const agent = ytdl.createProxyAgent(
  //   { uri: proxyUrl },
  //   JSON.parse(fs.readFileSync("cookies.json"))
  // );
  const agent =new HttpsProxyAgent(proxyUrl);

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout: Exceeded ${TIMEOUT_MS} ms`)),
        TIMEOUT_MS
      )
    );

    const startTime = Date.now();
    const [videoInfo, error] = await Promise.race([
      getVideoInfo(videoUrl, formatType, quality, agent),
      timeoutPromise,
    ]);

    if (videoInfo && videoInfo.title) {
      const duration = Date.now() - startTime;
      console.log(
        `Proxy ${proxy} valid. Time taken: ${duration} ms, Video Title: ${videoInfo.title}`
      );
      return proxy; // Return the proxy only if videoInfo is valid
    } else {
      throw new Error(error || "Video title is null");
    }
  } catch (error) {
    console.error(`Error testing proxy ${proxy}: ${error.message}`);
    return null; // Return null for invalid proxies
  }
}

// Function to get video info
async function getVideoInfo(url, formatType, quality, agent) {
  try {
    const info = await ytdl.getInfo(url, { requestOptions: { agent } });
    const bestFormat = ytdl.chooseFormat(info.formats, {
      quality: formatType === "mp3" ? "highestaudio" : null,
      filter: (format) => {
        if (formatType === "mp3") return format.hasAudio;
        return (
          format.container === formatType && format.qualityLabel === quality
        );
      },
    });

    return [{ title: info.videoDetails.title, format: bestFormat }, null];
  } catch (error) {
    return [null, error.message];
  }
}

// Function to test proxies with concurrency
async function testProxies(
  proxies,
  videoUrl,
  formatType,
  quality,
  concurrency,
  cookies
) {
  const limit = pLimit(concurrency);
  const results = await Promise.all(
    proxies.map((proxy) =>
      limit(() => testProxy(proxy, videoUrl, formatType, quality, cookies))
    )
  );
  return results.filter(Boolean);
}

// Main function
async function main() {
  const args = minimist(process.argv.slice(2));
  const videoUrl =
    args.url || "https://youtu.be/jKcHOJDwm9A?si=OJwWI10TvE_BnILj";
  const formatType = args.format || "mp4";
  const quality = args.quality || "1080p";
  const concurrency = args.concurrency || 5000;

  try {
    const cookies = readCookies("cookies.json");
    const proxies = await readProxiesFromFile("proxies.txt");

    console.log(
      `Testing ${proxies.length} proxies with concurrency ${concurrency}...`
    );
    const workingProxies = await testProxies(
      proxies,
      videoUrl,
      formatType,
      quality,
      concurrency,
      cookies
    );

    console.log("Working proxies:", workingProxies);
    fs.writeFileSync("working_proxies.txt", workingProxies.join("\n"), "utf8");
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

// Execute main function
main();
