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

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
