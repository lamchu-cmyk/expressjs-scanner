const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

/* ===== helper: đợi trang thật sự load xong ===== */
async function waitUntilLoaded(rawUrl) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Thêm protocol nếu thiếu
    let url = rawUrl;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    /* 1. Chỉ cần DOM sẵn trước đã */
    await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout  : 120_000        // 2 phút
    });

    /* 2. Đợi tới khi sự kiện load hoàn tất */
    await page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: 120_000 }
    );

    /* 3. Đợi tất cả ảnh/iframe đã hoàn thành */
    await page.waitForFunction(
        () => [...document.images].every(img => img.complete),
        { timeout: 120_000 }
    );

    /* 4. Tự dựng “network-idle”: không còn request nào
          trong 1 giây */
    await waitForNetworkIdle(page, 1000, 120_000);

    await browser.close();
}

/* ===== util chờ network-idle ===== */
function waitForNetworkIdle(page, idleMillis = 1000, timeout = 60_000) {
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
app.post('/check-load', async (req,res) => {
    const { url } = req.body;
    if(!url) return res.status(400).json({ ok:false, error:'Missing url' });

    try{
        await waitUntilLoaded(url);
        return res.json({ ok:true });
    }catch(err){
        return res.status(500).json({ ok:false, error: err.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
