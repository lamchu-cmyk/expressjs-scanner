const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// Home route
app.get('/', (req, res) => {
    res.render('index', { 
        title: 'URL Scanner',
        urls: null,
        error: null 
    });
});

// Scan URL route
app.post('/scan', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.render('index', {
            title: 'URL Scanner',
            urls: null,
            error: 'Please enter a valid URL'
        });
    }

    try {
        console.log(`Scanning URL: ${url}`);
        
        // Launch Puppeteer
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Add protocol if missing
        let targetUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            targetUrl = 'https://' + url;
        }
        
        await page.goto(targetUrl, { 
            waitUntil: 'networkidle2', // Less strict than 'networkidle2'
            timeout: 120000 // Increase timeout to 45 seconds? no it 2 min 
        });
        
        // Wait a bit more for dynamic content to load
        await page.waitForTimeout(2000);
        
        // Extract all URLs from the page
        const urls = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            const urlMap = new Map(); // Use Map instead of Set
            
            links.forEach(link => {
                const href = link.href;
                if (href && href.startsWith('http')) {
                    // Use URL as key to properly deduplicate
                    if (!urlMap.has(href)) {
                        urlMap.set(href, {
                            url: href,
                            text: link.textContent.trim() || href,
                            title: link.title || ''
                        });
                    }
                }
            });
            
            return Array.from(urlMap.values());
        });
        
        await browser.close();
        
        console.log(`Found ${urls.length} URLs before filtering`);

        /* --------- GIỮ LẠI LIÊN KẾT CÙNG DOMAIN --------- */
        const targetHostname = new URL(targetUrl).hostname.replace(/^www\./, '');

        const filteredUrls = urls.filter(link => {
            try {
                const host = new URL(link.url).hostname.replace(/^www\./, '');
                // Giữ lại nếu host là chính domain hoặc sub-domain của trang quét
                return host.endsWith(targetHostname);
            } catch {
                return false;   // Bỏ qua URL không hợp lệ
            }
        });

        console.log(`Found ${filteredUrls.length} URLs after filtering`);
        
        res.render('index', {
            title: 'URL Scanner',
            urls: filteredUrls,   // dùng danh sách đã lọc
            error: null,
            scannedUrl: targetUrl
        });
        
    } catch (error) {
        console.error('Error scanning URL:', error);
        res.render('index', {
            title: 'URL Scanner',
            urls: null,
            error: `Error scanning URL: ${error.message}`
        });
    }
});

app.post('/scan-batch', async (req, res) => {
  const urls        = req.body.urls;        // mảng ['https://site1.com', ...]
  const concurrency = 10;                   // số tab chạy cùng lúc
  const results     = [];

  const browser = await puppeteer.launch({ headless: true });
  try {
    for (let i = 0; i < urls.length; i += concurrency) {
      const slice = urls.slice(i, i + concurrency);

      // 1. Khởi đồng loạt 10 trang
      const pages = await Promise.all(slice.map(() => browser.newPage()));

      // 2. Map từng page với URL, đợi cả network idle + response API batch
      const jobs = slice.map((url, idx) => (async () => {
        const page = pages[idx];

        // Bắt request tới API batch (chỉnh lại điều kiện match tuỳ endpoint thực tế)
        const apiPromise = page.waitForResponse(response =>
          response.url().includes('/your-batch-endpoint') &&
          response.status() === 200
        );

        // Chạy load page, đợi network idle (hết request trong 500 ms)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Đợi API batch trả về JSON
        const apiRes  = await apiPromise;
        const apiData = await apiRes.json();

        results.push({ url, data: apiData });
      })());

      // 3. Chờ xong cả chùm 10 tab, rồi đóng
      await Promise.all(jobs);
      await Promise.all(pages.map(p => p.close()));
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    await browser.close();
  }
});

async function waitWithPuppeteer(url, timeout = 20000) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await browser.close();
}

/* ===== util chờ network-idle ===== */
function waitForNetworkIdle(page, idleMillis = 1000, timeout = 5_000) {
    return new Promise((resolve, reject) => {
        let inflight = 0;
        let idleTimer;

        function onRequest()   { ++inflight; clearTimeout(idleTimer); }
        function onComplete()  {
            if (inflight > 0) --inflight;
            if (inflight === 0) idleTimer = setTimeout(done, idleMillis);
        }
        function done() {
            cleanup();
            resolve();
        }
        function cleanup(err) {
            page.removeListener('request', onRequest);
            page.removeListener('requestfinished', onComplete);
            page.removeListener('requestfailed', onComplete);
            clearTimeout(idleTimer);
            if (err) reject(err);
        }

        page.on('request',         onRequest);
        page.on('requestfinished', onComplete);
        page.on('requestfailed',   onComplete);

        // Hết giờ
        idleTimer = setTimeout(
            () => cleanup(new Error('network idle timeout')),
            timeout + idleMillis
        );
    });
}

/* ===== API: POST /check-load { url } ===== */
app.post('/check-load', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: 'Missing url' });

    try {
        await waitWithPuppeteer(url);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
/* ===== API: POST /check-load/batch { urls } ===== */
app.post('/check-load/batch', async (req, res) => {
    const { urls } = req.body;
    if (!Array.isArray(urls) || !urls.length)
        return res.status(400).json({ ok: false, error: 'Missing urls' });

    const results = {};
    await Promise.all(
        urls.map(async raw => {
            const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            try {
                await waitWithPuppeteer(url, 15000);   // 15 s timeout / url
                results[raw] = { ok: true };
            } catch (e) {
                results[raw] = { ok: false, error: e.message };
            }
        })
    );

    const hasFail = Object.values(results).some(r => !r.ok);
    res.json({ ok: !hasFail, results });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
