import fs from "fs";
import ytdl from "@distube/ytdl-core";
import pLimit from "p-limit";
import minimist from "minimist";
import YTDlpWrap from "yt-dlp-wrap";
import https from "https";

// Configurable constants
const TIMEOUT_MS = 50000; // Timeout for each proxy test

function formatCookies(cookieObj) {
  return Object.entries(cookieObj)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}
function createProxyAgent(proxyUrl, cookies) {
  const agentOptions = {
    uri: proxyUrl,
    rejectUnauthorized: false, // Disable cert validation// Disable TLS/SSL certificate validation for this agent
    headers: {
      Cookie: formatCookies(cookies),
      host: "www.youtube.com", // Force Host header
    },
  };
  return ytdl.createProxyAgent(agentOptions);
}
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
      .filter((line) => line.includes(":")) // Ensure valid lines
      .map((line) => {
        const [host, port, username, password] = line.split(":"); // Extract only host and port

        if (username && password) {
          return `${username}:${password}@${host}:${port}`;
        }
        return `${host}:${port}`;
      });
    // .filter(isValidProxy); // Validate the extracted host:port
  } catch (error) {
    throw new Error(`Error reading proxies file: ${error.message}`);
  }
}

// Function to test a single proxy for video info
async function testProxy(proxy, videoUrl, formatType, quality, cookies) {
  const proxyUrl = proxy.startsWith("http") ? proxy : `http://${proxy}`;
  // console.log(proxyUrl);
  const agent = createProxyAgent(proxyUrl, cookies);
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
    const info = await ytdl.getInfo(url, {
      agent,
    });
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
  return results.filter(Boolean); // Filter out invalid proxies
}

// Function to download video using a proxy
async function downloadBasicWay(proxy, url, formatType, quality, cookies) {
  const proxyUrl = proxy.startsWith("http") ? proxy : `http://${proxy}`;
  const agent = createProxyAgent(proxyUrl, cookies);

  try {
    const info = await ytdl.getInfo(url, {
      agent,
    });
    const bestFormat = ytdl.chooseFormat(info.formats, {
      filter: (format) => {
        if (formatType === "mp3") {
          return format?.mimeType?.match(/audio/);
        }
        return (
          format.container === formatType && format.qualityLabel === quality
        );
      },
    });

    console.log(`Attempting download with proxy: ${proxy}`);
    const ytDownload = ytdl(url, {
      format: bestFormat,
    });

    const filePath = `./${info.videoDetails.title}.${bestFormat.container}`;
    const writeStream = fs.createWriteStream(filePath);

    ytDownload.pipe(writeStream);

    return new Promise((resolve, reject) => {
      ytDownload.on("end", () => {
        console.log(`Download successful with proxy: ${proxy}`);
        resolve(proxy);
      });

      ytDownload.on("error", (error) => {
        console.error(`Download failed with proxy ${proxy}: ${error.message}`);
        reject(error);
      });
    });
  } catch (error) {
    console.error(
      `Error in downloadBasicWay with proxy ${proxy}: ${error.message}`
    );
    throw error;
  }
}

// Main function
async function main() {
  const args = minimist(process.argv.slice(2));
  const videoUrl =
    args.url ||
    "https://www.youtube.com/watch?v=WbLoRwtLT-Q&t=516s&ab_channel=Oliur%2FUltraLinx";
  const formatType = args.format || "webm";
  const quality = args.quality || "1440p";
  const concurrency = args.concurrency || 4000;

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

    if (workingProxies.length > 0) {
      for (const proxy of workingProxies) {
        try {
          await downloadBasicWay(proxy, videoUrl, formatType, quality, cookies);
          console.log(`Video successfully downloaded using proxy: ${proxy}`);
          break; // Stop testing once a download succeeds
        } catch (error) {
          console.error(`Download failed with proxy: ${proxy}`);
          // Continue to the next proxy if the download fails
        }
      }
    } else {
      console.error("No working proxies found.");
    }

    fs.writeFileSync("working_proxies.txt", workingProxies.join("\n"), "utf8");
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

// Execute main function
main();
