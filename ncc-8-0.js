const fs = require('fs');
const path = require('path');

// Function to set geolocation in a Puppeteer page
async function setGeolocation(page, latitude, longitude) {
  await page.setGeolocation({ latitude, longitude });
}

const { launch: puppeteerLaunch } = require('puppeteer-core');
const { launch, getStream } = require('puppeteer-stream');
const child_process = require('child_process');
const process = require('process');
const express = require('express');
const morgan = require('morgan');
require('express-async-errors');
require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l)',
});

const viewport = {
  width: 1920,
  height: 1080,
};

var currentBrowser, dataDir, lastPage;

const getCurrentBrowser = async () => {
  if (!currentBrowser || !currentBrowser.isConnected()) {
    currentBrowser = await launch(
      {
        launch: (opts) => {
          if (process.pkg) {
            opts.args = opts.args.filter(
              (arg) =>
                !arg.startsWith('--load-extension=') &&
                !arg.startsWith('--disable-extensions-except=')
            );
            opts.args = opts.args.concat([
              `--load-extension=${path.join(dataDir, 'extension')}`,
              `--disable-extensions-except=${path.join(dataDir, 'extension')}`,
            ]);
          }
          if (process.env.DOCKER || process.platform == 'win32') {
            opts.args = opts.args.concat(['--no-sandbox']);
          }
          opts.headless = false; // Set headless mode to false
          return puppeteerLaunch(opts);
        },
      },
      {
        executablePath: getExecutablePath(),
        defaultViewport: null, // no viewport emulation
        userDataDir: path.join(dataDir, 'chromedata'),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--window-size=1920,1080', // Set viewport resolution
          '--disable-notifications', // Mimic real user behavior
          '--disable-extensions', // Avoid using extensions that might be detected
          '--disable-dev-shm-usage',
          '--disable-background-timer-throttling',
          '--disable-client-side-phishing-detection',
          '--disable-default-apps',
          '--disable-hang-monitor',
          '--disable-popup-blocking',
          '--disable-session-crashed-bubble',
          '--disable-sync',
          '--hide-scrollbars',
          '--disable-notifications',
          '--no-first-run',
          '--disable-infobars',
          '--hide-crash-restore-bubble',
          '--disable-blink-features=AutomationControlled',
          '--enable-accelerated-video-decode',
          '--enable-accelerated-video-encode',
          '--enable-features=UseSurfaceLayerForVideoCapture',
          '--enable-gpu-rasterization',
          '--enable-oop-rasterization',
          '--disable-software-rasterizer',
          '--disable-gpu-vsync',
          '--enable-audio-output', // Ensure audio output is enabled
          '--disable-web-security',
        ],
        ignoreDefaultArgs: [
          '--enable-automation',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-component-update',
          '--disable-component-extensions-with-background-pages',
          '--enable-blink-features=IdleDetection',
        ],
      }
    );
    currentBrowser.on('close', () => {
      currentBrowser = null;
    });
    currentBrowser.pages().then((pages) => {
      pages.forEach((page) => page.close());
    });
  }
  return currentBrowser;
};


const getExecutablePath = () => {
  if (process.env.CHROME_BIN) {
    return process.env.CHROME_BIN;
  }

  let executablePath;
  if (process.platform === 'linux') {
    try {
      executablePath = child_process.execSync('which chromium-browser').toString().split('\n').shift();
    } catch (e) {
      // NOOP
    }

    if (!executablePath) {
      executablePath = child_process.execSync('which chromium').toString().split('\n').shift();
      if (!executablePath) {
        throw new Error('Chromium not found (which chromium)');
      }
    }
  } else if (process.platform === 'darwin') {
    executablePath = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ].find(fs.existsSync);
  } else if (process.platform === 'win32') {
    executablePath = [
      `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`,
      `C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`,
      path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
    ].find(fs.existsSync);
  } else {
    throw new Error('Unsupported platform: ' + process.platform);
  }

  return executablePath;
};

async function main() {
  dataDir = process.cwd();
  if (process.pkg) {
    switch (process.platform) {
      case 'darwin':
        dataDir = path.join(process.env.HOME, 'Library', 'Application Support', 'ChromeCapture');
        break;
      case 'win32':
        dataDir = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ChromeCapture');
        break;
    }
    let out = path.join(dataDir, 'extension');
    fs.mkdirSync(out, { recursive: true });
    ['manifest.json', 'background.js', 'options.html', 'options.js'].forEach((file) => {
      fs.copyFileSync(
        path.join(process.pkg.entrypoint, '..', 'node_modules', 'puppeteer-stream', 'extension', file),
        path.join(out, file)
      );
    });
  }

  const app = express();

  const df = require('dateformat');
  morgan.token('mydate', function (req) {
    return df(new Date(), 'yyyy/mm/dd HH:MM:ss.l');
  });
  app.use(morgan('[:mydate] :method :url from :remote-addr responded :status in :response-time ms'));

  app.get('/', (req, res) => {
    res.send(
      `<html>
  <title>Chrome Capture for Channels</title>
  <h2>Chrome Capture for Channels</h2>
  <p>Usage: <code>/stream?url=URL</code> or <code>/stream/&lt;name></code></p>
  <pre>
  #EXTM3U

  #EXTINF:-1 channel-id="windy",Windy
  chrome://${req.get('host')}/stream/windy

  #EXTINF:-1 channel-id="weatherscan",Weatherscan
  chrome://${req.get('host')}/stream/weatherscan
  </pre>
  </html>`
    );
  });

  app.get('/debug', async (req, res) => {
    res.send(`<html>
    <script>
    async function videoClick(e) {
      e.target.focus()
      let x = ((e.clientX - e.target.offsetLeft) * e.target.videoWidth) / e.target.clientWidth
      let y = ((e.clientY - e.target.offsetTop) * e.target.videoHeight) / e.target.clientHeight
      console.log('video click', x, y)
      await fetch('/debug/click/' + x + '/' + y)
    }
    async function videoKeyPress(e) {
      console.log('video keypress', e.key)
      await fetch('/debug/keypress/' + e.key)
    }
    document.addEventListener('keypress', videoKeyPress)
    </script>
    <video style="width: 100%; height: 100%" onKeyPress="videoKeyPress(event)" onClick="videoClick(event)" src="/stream?waitForVideo=false&url=${encodeURIComponent(
      req.query.url || 'https://google.com'
    )}" autoplay muted />
    </html>`);
  });

  app.get('/debug/click/:x/:y', async (req, res) => {
    let browser = await getCurrentBrowser();
    let pages = await browser.pages();
    if (pages.length == 0) {
      res.send('false');
      return;
    }
    let page = pages[pages.length - 1];
    await page.mouse.click(parseInt(req.params.x), parseInt(req.params.y));
    console.log('Mouse right-clicked');
    await page.keyboard.press('Escape');
    await page.keyboard.type(channel); // Use the variable without quotes
    console.log('Keys pressed: ' + channel);
    res.send('true');
  });

  app.get('/debug/keypress/:key', async (req, res) => {
    let browser = await getCurrentBrowser();
    let pages = await browser.pages();
    if (pages.length == 0) {
      res.send('false');
      return;
    }
    let page = pages[pages.length - 1];
    await page.keyboard.press(req.params.key);
    res.send('true');
  });

let pageCounter = 0;

app.get('/stream/:name?', async (req, res) => {

  // Extract the channel name from the "ch" query parameter of the URL.
  const urlParam = req.query.url;
  const channelMatch = urlParam.match(/[?&]ch=([^&]+)/);
  const channel = channelMatch ? channelMatch[1] : null;
  
  // Add this line to create the new variable gpsChannel and set it equal to channel
  let gpsChannel = channel;

if (gpsChannel !== "CBSMiami" && 
    gpsChannel !== "CBSNY" && 
    gpsChannel !== "CBSBuffalo" && 
    gpsChannel !== "CBSBoston" && 
    gpsChannel !== "CBSBaltimore" && 
    gpsChannel !== "CBSCincinnati" && 
    gpsChannel !== "CBSCleveland" && 
    gpsChannel !== "CBSPittsburgh" && 
    gpsChannel !== "CBSHouston" && 
    gpsChannel !== "CBSIN" && 
    gpsChannel !== "CBSJville" && 
    gpsChannel !== "CBSTN" && 
    gpsChannel !== "CBSDenver" && 
    gpsChannel !== "CBSKC" && 
    gpsChannel !== "CBSLasVegas" && 
    gpsChannel !== "CBSDallas" && 
    gpsChannel !== "CBSPhilly" && 
    gpsChannel !== "CBSWA" && 
    gpsChannel !== "CBSChicago" && 
    gpsChannel !== "CBSDetroit" && 
    gpsChannel !== "CBSGB" && 
    gpsChannel !== "CBSMN" && 
    gpsChannel !== "CBSATL" && 
    gpsChannel !== "CBSNC" && 
    gpsChannel !== "CBSNO" && 
    gpsChannel !== "CBSTB" && 
    gpsChannel !== "CBSAZ" && 
    gpsChannel !== "CBSLA" && 
    gpsChannel !== "CBSSanFran" && 
    gpsChannel !== "CBSSeattle" &&
    gpsChannel !== "CBSMontgomery" && 
    gpsChannel !== "CBSBirmingham" &&
    gpsChannel !== "default") {
  // Set gpsChannel to the default value here
  gpsChannel = "default"; // This is now valid because gpsChannel is declared with let
}
  if (channel) {
    // Use the extracted channel name
    console.log('Channel:', channel);
  } else {
    // Handle the case where the "ch" query parameter is missing.
    console.log('No channel specified in the URL.');
  }

    var u = req.query.url;
    let name = req.params.name;
    if (name) {
      u = {
        nbc: 'https://www.nbc.com/live?brand=nbc&callsign=nbc',
        cnbc: 'https://www.nbc.com/live?brand=cnbc&callsign=cnbc',
        msnbc: 'https://www.nbc.com/live?brand=msnbc&callsign=msnbc',
        nbcnews: 'https://www.nbc.com/live?brand=nbc-news&callsign=nbcnews',
        bravo: 'https://www.nbc.com/live?brand=bravo&callsign=bravo_east',
        bravop: 'https://www.nbc.com/live?brand=bravo&callsign=bravo_west',
        e: 'https://www.nbc.com/live?brand=e&callsign=e_east',
        ep: 'https://www.nbc.com/live?brand=e&callsign=e_west',
        golf: 'https://www.nbc.com/live?brand=golf&callsign=golf',
        oxygen: 'https://www.nbc.com/live?brand=oxygen&callsign=oxygen_east',
        oxygenp: 'https://www.nbc.com/live?brand=oxygen&callsign=oxygen_west',
        syfy: 'https://www.nbc.com/live?brand=syfy&callsign=syfy_east',
        syfyp: 'https://www.nbc.com/live?brand=syfy&callsign=syfy_west',
        usa: 'https://www.nbc.com/live?brand=usa&callsign=usa_east',
        usap: 'https://www.nbc.com/live?brand=usa&callsign=usa_west',
        universo: 'https://www.nbc.com/live?brand=nbc-universo&callsign=universo_east',
        universop: 'https://www.nbc.com/live?brand=nbc-universo&callsign=universo_west',
        necn: 'https://www.nbc.com/live?brand=necn&callsign=necn',
        nbcsbayarea: 'https://www.nbc.com/live?brand=rsn-bay-area&callsign=nbcsbayarea',
        nbcsboston: 'https://www.nbc.com/live?brand=rsn-boston&callsign=nbcsboston',
        nbcscalifornia: 'https://www.nbc.com/live?brand=rsn-california&callsign=nbcscalifornia',
        nbcschicago: 'https://www.nbc.com/live?brand=rsn-chicago&callsign=nbcschicago',
        nbcsphiladelphia: 'https://www.nbc.com/live?brand=rsn-philadelphia&callsign=nbcsphiladelphia',
        nbcswashington: 'https://www.nbc.com/live?brand=rsn-washington&callsign=nbcswashington',
        weatherscan: 'https://weatherscan.net/',
        windy: 'https://windy.com',
      }[name];
    }

// Define latitude and longitude values for different channels
const channelCoordinates = {
  'CBSMiami': { latitude: 25.958, longitude: -80.239 },
  'CBSNY': { latitude: 40.716, longitude: -74.003 },
  'CBSMontgomery': { latitude: 32.366, longitude: -86.300 },
  'CBSBuffalo': { latitude: 42.8864, longitude: -78.8784 },
  'CBSBoston': { latitude: 42.0654, longitude: -71.5387 },
  'CBSBaltimore': { latitude: 39.2904, longitude: -76.6122 },
  'CBSCincinnati': { latitude: 39.1031, longitude: -84.5120 },
  'CBSCleveland': { latitude: 41.4993, longitude: -81.6944 },
  'CBSPittsburgh': { latitude: 40.4406, longitude: -79.9959 },
  'CBSHouston': { latitude: 29.7604, longitude: -95.3698 },
  'CBSIN': { latitude: 39.7684, longitude: -86.1581 },
  'CBSJville': { latitude: 30.3322, longitude: -81.6557 },
  'CBSTN': { latitude: 36.1627, longitude: -86.7816 },
  'CBSDenver': { latitude: 39.7392, longitude: -104.9903 },
  'CBSKC': { latitude: 39.0997, longitude: -94.5786 },
  'CBSLasVegas': { latitude: 36.1699, longitude: -115.1398 },
  'CBSDallas': { latitude: 32.7497, longitude: -97.3328 },
  'CBSPhilly': { latitude: 39.9526, longitude: -75.1652 },
  'CBSWA': { latitude: 38.9540, longitude: -76.8667 },
  'CBSChicago': { latitude: 41.8781, longitude: -87.6298 },
  'CBSDetroit': { latitude: 42.3314, longitude: -83.0458 },
  'CBSGB': { latitude: 44.5133, longitude: -88.0159 },
  'CBSMN': { latitude: 44.9778, longitude: -93.2650 },
  'CBSATL': { latitude: 33.7490, longitude: -84.3880 },
  'CBSNC': { latitude: 35.2271, longitude: -80.8431 },
  'CBSNO': { latitude: 29.9511, longitude: -90.0715 },
  'CBSTB': { latitude: 27.9506, longitude: -82.4572 },
  'CBSAZ': { latitude: 33.5371, longitude: -112.0880 },
  'CBSLA': { latitude: 33.9564, longitude: -118.3406 },
  'CBSSanFran': { latitude: 37.3541, longitude: -121.9552 },
  'CBSSeattle': { latitude: 47.6062, longitude: -122.3321 },
  'CBSBirmingham': { latitude: 33.518, longitude: -86.810 },
  'default': { latitude: 33.518, longitude: -86.810 },
  // Add coordinates for other channels as needed
};

// Check if the specified gpsChannel exists in the coordinates object
if (gpsChannel in channelCoordinates) {
  const { latitude, longitude } = channelCoordinates[gpsChannel];
  console.log(latitude, longitude);
  var waitForVideo = req.query.waitForVideo === 'false' ? false : true;
  switch (name) {
    case 'weatherscan':
    case 'windy':
      waitForVideo = false;
  }
  var minimizeWindow = false;
  if (process.platform == 'darwin' && waitForVideo) minimizeWindow = true;

  var browser, page;
  try {
    browser = await getCurrentBrowser();
    page = await browser.newPage();

    // Set the geolocation for the page
    console.log(latitude, longitude);
    await setGeolocation(page, latitude, longitude);

  } catch (e) {
    console.log('failed to start browser page', u, e);
    res.status(500).send(`failed to start browser page: ${e}`);
    return;
  }
} else {
  // Handle the case where the specified channel is not found in the coordinates object
  console.log(`Channel "${channel}" not found in coordinates.`);
  res.status(404).send(`Channel "${channel}" not found.`);
}

// Increment the page counter
pageCounter++;

// Default settings
let bitrate = 5940000; // Default bitrate
let audio = 192000; // Default audio bitrate
let fr = 30;

// Determine settings based on URL parameters
if (urlParam.includes("nbc.com")) {
  // Set specific settings for NBC
  bitrate = 15400000; // Example bitrate for NBC
  audio = 192000; // Example audio bitrate for NBC
} else if (urlParam.includes("cbs.com")) {
  // Set different settings for CBS
  bitrate = 15400000; // Example bitrate for CBS
  audio = 192000; // Example audio bitrate for CBS
} else if (urlParam.includes("peacocktv.com")) {
  // Set different settings for Peacock
  bitrate = 15400000; // Example bitrate for PeacockTV
  audio = 192000; // Example audio bitrate for PeacockTV
} else if (urlParam.includes("puffer.standford.edu")) {
  // Set different settings for Peacock
  bitrate = 15400000; // Example bitrate for Puffer
  audio = 192000; // Example audio bitrate for Puffer
} else {
  // Default settings if none of the above conditions match
  bitrate = 5940000; // Default bitrate
  audio = 192000; // Default audio bitrate
}

// Log the settings for debugging
console.log(`Settings for URL ${urlParam}: Bitrate: ${bitrate}, Audio: ${audio}, Frame Rate: ${fr}`);

// CBS Sunday ticket click
if (urlParam.includes("cbs.com/live-tv/stream/")) {
  // Handle the case when "cbs.com/live-tv/stream/" is in the URL
  console.log("URL contains cbs.com/live-tv/stream/");

  try {
    setTimeout(async () => {
      const browser = await getCurrentBrowser();
      const pages = await browser.pages();
      if (pages.length > 0) {
        const page = pages[pages.length - 1];
        // Add a delay of 4000 milliseconds (4.25 seconds) before clicking
        await page.waitForTimeout(4250);

      // Get the page dimensions
      const { innerWidth, innerHeight } = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }));

      // Calculate click position (10% lower than the middle)
      const x = innerWidth / 2;
      const y = (innerHeight / 2) * 1.05;

      // Specify click type ('left' or 'right')
      const clickType = 'left'; // Change to 'right' for a right click

      // Perform the click
      await page.mouse.click(x, y, { button: clickType });

      console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);


        // Wait 3 seconds
        await page.waitForTimeout(3000);

        // Press 'f' to go into video player fullscreen
        await page.keyboard.press('f');
        console.log("Pressed 'f' for video fullscreen");
      } else {
        console.log('No pages available for mouse click.');
      }
    });
  } catch (e) {
    // Handle any errors specific to cbs.com/live-tv/stream/...
    console.log('Error for cbs.com/live-tv/stream/:', e);
  }
}


// End CBS

    try {
      const stream = await getStream(page, {
        videoCodec: 'h264_nvenc', // Use NVENC for video encoding
        audioCodec: 'aac', // Use AAC for audio encoding
        video: true,
        audio: true,
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: audio,
        mimeType: 'video/webm;codecs=H264',
        videoConstraints: {
          mandatory: {
            minWidth: viewport.width,
            minHeight: viewport.height,
            maxWidth: viewport.width,
            maxHeight: viewport.height,
            minFrameRate: 'fr',
          },
        },
      });
      console.log('Streaming:', channel);
      console.log('Streaming', u);
      console.log('Bitrate', bitrate);
      stream.pipe(res);
      res.on('close', async (err) => {
        await stream.destroy();
        await page.close();
        console.log('finished', u);
      });
    } catch (e) {
      console.log('failed to start stream', u, e);
      res.status(500).send(`failed to start stream: ${e}`);
      await page.close();
      return;
    }

    try {
      await page.goto(u);
      if (waitForVideo) {
        await page.waitForSelector('video')
        await page.waitForFunction(`(function() {
          let video = document.querySelector('video')
          return video.readyState === 4
        })()`);
        await page.evaluate(`(function() {
          let video = document.querySelector('video')
          video.style.zIndex = '999000'
          video.style.background = 'black'
          video.style.cursor = 'none'
          video.style.transform = 'translate(0, 0)'
          video.style.objectFit = 'contain'
          video.play()
          video.muted = false
          video.removeAttribute('muted')
          let header = document.querySelector('.header-container')
          if (header) {
            header.style.zIndex = '0'
          }
        })()`);
      }

      const uiSize = await page.evaluate(`(function() {
        return {
          height: window.outerHeight - window.innerHeight,
          width: window.outerWidth - window.innerWidth,
        }
      })()`);
      const session = await page.target().createCDPSession();
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          height: viewport.height + uiSize.height,
          width: viewport.width + uiSize.width,
        },
      });
      if (minimizeWindow) {
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            windowState: 'minimized',
          },
        });
      }
    } catch (e) {
      console.log('failed to stream', u, e);
    }

//Test script//

console.log("urlParam:", urlParam);

// Check if urlParam contains "stream.directv.com" , "watch.spectrum.net" , "cbs.com/live-tv/stream/" or "puffer.stanford.edu/player" 
if (urlParam.includes("stream.directv.com")) {
  // Handle the case when "stream.directv.com" is in the URL
  console.log("URL contains stream.directv.com");
  // Your code for "stream.directv.com" here
  try {
    setTimeout(async () => {
      const browser = await getCurrentBrowser();
      const pages = await browser.pages();
      if (pages.length > 0) {
        const page = pages[pages.length - 1];
        // Simulate pressing the Tab key 6 times
        for (let i = 0; i < 6; i++) {
            await page.waitForTimeout(700);
            await page.keyboard.press('Tab');
            await page.waitForTimeout(500); // Optional: Add a short delay between each Tab press
        }
        console.log('Searching DirecTVStream Channel List');
        await page.keyboard.type(channel); // Use the variable without quotes      
        // Add a buffer time of 85 milliseconds (.085 seconds)
        await new Promise(resolve => setTimeout(resolve, 85));
        console.log('Channel: ' + channel);
        // Add a buffer time of .975 milliseconds (10.3 seconds)
        await new Promise(resolve => setTimeout(resolve, 1030));
        await page.mouse.click(755, 150, { button: 'left' }); // Second click (left-click) - Only line added
        console.log('Loading Channel: ' + channel);
       await new Promise(resolve => setTimeout(resolve, 10000));
        // Trigger fullscreen mode using the Fullscreen API
        await new Promise(resolve => setTimeout(resolve, 1030));
        await page.evaluate(() => {
          const element = document.documentElement;
          if (element.requestFullscreen) {
            element.requestFullscreen();
          } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
          } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
          } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
          }
        });

      } else {
        console.log('No pages available for mouse click.');
      }
    }, 65); // Delay in milliseconds (adjust as needed)
  } catch (e) {
    console.log('Error for stream.directv.com:', e);
  }
} else if (urlParam.includes("watch.spectrum.net")) {
  // Handle the case when "watch.spectrum.net" is in the URL
  console.log("URL contains watch.spectrum.net");
  try {
    // Your code for watch.spectrum.com here...
    // Trigger fullscreen mode using the Fullscreen API
    await new Promise(resolve => setTimeout(resolve, 1030));
    await page.evaluate(() => {
      const element = document.documentElement;
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
      }
    });
  } catch (e) {
    // Handle any errors specific to watch.spectrum.com...
    console.log('Error for watch.spectrum.com:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=C")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=C" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=C");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-CBS");

    // Function to press down arrow twice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=C...
    console.log('Error for puffer.stanford.edu/player/?ch=C:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=I")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=I" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=I");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-CBS-I");

    // Function to press down arrow thrice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {
      // Press the down arrow key twice
      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Once");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=I...
    console.log('Error for puffer.stanford.edu/player/?ch=I:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=N")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=N" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=N");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-FOX");

    // Function to press down arrow thrice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {
      // Press the down arrow key twice
      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Once");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Twice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=N...
    console.log('Error for puffer.stanford.edu/player/?ch=N:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=F")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=F" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=F");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-FOX");

    // Function to press down arrow thrice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {
      // Press the down arrow key twice
      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Once");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Twice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Thrice");

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=F...
    console.log('Error for puffer.stanford.edu/player/?ch=F:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=P")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=P" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=P");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-FOX");

    // Function to press down arrow thrice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {
      // Press the down arrow key twice
      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Once");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Twice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Thrice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow 4X");

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=P...
    console.log('Error for puffer.stanford.edu/player/?ch=P:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=W")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=W" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=W");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-CW");

    // Function to press down arrow thrice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {
      // Press the down arrow key twice
      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Once");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Twice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Thrice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow 4X");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow 5X");

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=W...
    console.log('Error for puffer.stanford.edu/player/?ch=W:', e);
  }
} else if (urlParam.includes("puffer.stanford.edu/player/?ch=A")) {
  // Handle the case when "puffer.stanford.edu/player/?ch=A" is in the URL
  console.log("URL contains puffer.stanford.edu/player/?ch=A");

  try {
    // Check if the page has redirected to the login page
    const currentUrl = await page.url();
    if (currentUrl.includes("puffer.stanford.edu/accounts/login")) {
      console.log("Redirected to login page");

      // Function to handle tabbing and logging in
      async function handleLogin(page) {
        // Press Tab twice
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100); // Brief pause between key presses
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Twice");

        // Press Space
        await page.keyboard.press('Space');
        console.log("Pressed Space");

        // Press Tab again
        await page.waitForTimeout(100);
        await page.keyboard.press('Tab');
        console.log("Pressed Tab Once");

        // Press Enter
        await page.keyboard.press('Enter');
        console.log("Pressed Enter");

        // Wait for the login process to complete (e.g., page load)
        await page.waitForNavigation();
        console.log("Login completed, page loaded");
      }

      // Call the login handling function if redirected
      await handleLogin(page);
    }

    // Now that login is complete, run the player control logic
    console.log("Test Code for Puffer-FOX");

    // Function to press down arrow thrice, space, and then 'f'
    async function pressDownThenSpaceThenF(page) {
      // Press the down arrow key twice
      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Once");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Twice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow Thrice");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow 4X");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow 5X");

      // Wait for a brief moment (optional)
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowDown');
      console.log("Pressed Down Arrow 6X");

      // Press the space bar
      await page.keyboard.press('Space');
      console.log("Pressed Space");

      // Fetch open pages
      const pages = await browser.pages(); // Ensure the browser object is accessible here

      if (pages.length > 0) {
        // Add a delay before clicking
        await page.waitForTimeout(50);

        // Get the page dimensions
        const { innerWidth, innerHeight } = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));

        // Calculate click position (35% from left, 19% from bottom for 1920x1080 resolution)
        const x = innerWidth * 0.31;
        const y = innerHeight * 0.79; // 81% from the top = 19% from the bottom

        // Specify click type ('left' or 'right')
        const clickType = 'left'; // Change to 'right' for a right click

        // Perform the click
        await page.waitForTimeout(200);
        await page.mouse.click(x, y, { button: clickType });

        console.log(`Clicked at (${x}, ${y}) with a ${clickType} click`);

        // Wait for 1 second
        await page.waitForTimeout(150);

        // Press 'f'
        await page.keyboard.press('KeyF');
        console.log("Pressed F");
      }
    }

    // Now call the player control function after login (or if no login required)
    await pressDownThenSpaceThenF(page);

  } catch (e) {
    // Handle any errors specific to puffer.stanford.edu/player/?ch=A...
    console.log('Error for puffer.stanford.edu/player/?ch=A:', e);
  }

} else if (urlParam.includes("nbc")) {
  // Handle the case when "nbc" is in the URL
  console.log("URL contains nbc");

  try {
    // Press 'F' once to trigger fullscreen
    await page.keyboard.press('KeyF');
    console.log("Pressed F");

    // Function to simulate pressing the right arrow key every 3 minutes
    const pressRightArrowKey = async () => {
      try {
        await page.keyboard.press('ArrowRight');
        console.log("Right arrow key pressed");
      } catch (err) {
        console.log("Error pressing right arrow key:", err);
      }
    };

    // Start pressing the right arrow key every 3.5 hours
    setInterval(pressRightArrowKey, 12600000); // 180,000 ms = 3 minutes

  } catch (e) {
    // Handle any errors specific to nbc.com
    console.log('Error for nbc', e);
  }

} else if (urlParam.includes("wsfa.com")) {
  // Handle the case when "wsfa.com" is in the URL
  console.log("URL contains wsfa.com");
  try {
    // Your code for WSFA.com here...
    // Trigger fullscreen mode using the Fullscreen API
    await new Promise(resolve => setTimeout(resolve, 1030));
    await page.evaluate(() => {
      const element = document.documentElement;
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
      }
    });
  } catch (e) {
    // Handle any errors specific to wsfa...
    console.log('Error for wsfa', e);
  }
}else if (urlParam.includes("abc.com")) {
  // Handle the case when "abc.com" is in the URL
  console.log("URL contains abc.com");

  try {
    setTimeout(async () => {
      const browser = await getCurrentBrowser();
      const pages = await browser.pages();
      if (pages.length > 0) {
        const page = pages[pages.length - 1];

        console.log('Hitting Tab key 17 times quickly...');

        // Simulate hitting Tab key 17 times
        for (let i = 0; i < 17; i++) {
          await page.keyboard.press('Tab');
        }

        // Wait a moment before pressing Enter
        await new Promise(resolve => setTimeout(resolve, 3)); // Short delay before pressing Enter

        console.log('Pressing Enter...');
        await page.keyboard.press('Enter'); // Press Enter

        // (Optional) If you still want to click fullscreen, you can include that code here

      } else {
        console.log('No pages available for interaction.');
      }
    }); // Removed the delay in milliseconds
  } catch (e) {
    console.log('Error for abc.com:', e);
  }
} else if (urlParam.includes("peacock")) {
  // Handle the case when "peacock" is in the URL
  console.log("URL contains peacock");

  try {
    // Press 'F' once to trigger fullscreen
    await page.keyboard.press('KeyF');
    console.log("Pressed F");

    // Function to simulate pressing the right arrow key every 3 minutes
    const pressRightArrowKey = async () => {
      try {
        await page.keyboard.press('ArrowRight');
        console.log("Right arrow key pressed");
      } catch (err) {
        console.log("Error pressing right arrow key:", err);
      }
    };

    // Start pressing the right arrow key every 3.5 hours
    setInterval(pressRightArrowKey, 12600000); // 180,000 ms = 3.5 hours

  } catch (e) {
    // Handle any errors specific to peacock
    console.log('Error for peacock', e);
  }

} else {
  // Handle other cases here...
  console.log("URL does not contain either stream.directv.com, watch.spectrum.net, stanford.edu, nbc.com, or peacocktv.com");
}
});

//End of test code

  const server = app.listen(5589, () => {
    console.log('Chrome Capture server listening on port 5589');
  });
}

main();