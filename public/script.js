document.addEventListener('DOMContentLoaded', function() {
    const scanForm      = document.getElementById('scanForm');
    const loadingModal  = new bootstrap.Modal(document.getElementById('loadingModal'));
    const openAllBtn    = document.getElementById('openAllBtn');
    const stopAllBtn    = document.getElementById('stopAllBtn');
    const cancelScanBtn = document.getElementById('cancelScanBtn');
    const openSingleBtns = document.querySelectorAll('.open-single-btn');

    let stopRequested = false;   // <--- cờ dừng toàn cục
    let openedTabs    = [];      // <--- tập các tab đang mở ở batch hiện tại
    let delayTimeout  = null;    // <--- timeout chờ đóng batch
    let delayResolver = null;    // <--- hàm resolve của Promise chờ đóng

    // Show loading modal when form is submitted
    scanForm.addEventListener('submit', function(e) {
        const urlInput = document.getElementById('urlInput');
        const url = urlInput.value.trim();
        
        if (url) {
            loadingModal.show();
            
            // Change button text and disable it
            const scanBtn = document.getElementById('scanBtn');
            scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Scanning...';
            scanBtn.disabled = true;
        }
    });

    // Handle "Open All URLs" button
    if (openAllBtn) {
        openAllBtn.addEventListener('click', function () {
            stopRequested = false;          // reset cờ
            stopAllBtn.disabled = false;    // bật nút dừng

            // Lấy và khử trùng lặp URL
            const urls = Array.from(
                new Set(
                    Array.from(document.querySelectorAll('.url-link'))
                         .map(el => el.dataset.url)
                )
            );

            if (urls.length === 0) {
                alert('No URLs to open!');
                return;
            }

            if (urls.length > 5) {
                const confirmMessage = `This will open ${urls.length} new tabs. Are you sure you want to continue?`;
                if (!confirm(confirmMessage)) return;
            }

            const batchSize     = 10;     // Số tab mở mỗi đợt
            const dwellTimeMs   = 15000;  // Giữ tab bao lâu (ms) trước khi đóng

            // Hàm tiện ích đợi n ms
            const delay = ms => new Promise(res => setTimeout(res, ms));

            // IIFE async để dùng await
            (async () => {
                for (let i = 0; i < urls.length; i += batchSize) {
                    if (stopRequested) break;                 // thoát nếu người dùng nhấn dừng
                    const batch = urls.slice(i, i + batchSize);

                    // 1. Mở tab và lưu handle
                    openedTabs = batch.map(u => {
                        /* gọi check-load cho từng URL */
                        fetch('/check-load',{
                            method:'POST',
                            headers:{'Content-Type':'application/json'},
                            body:JSON.stringify({ url: u })
                        })
                        .then(r=>r.json())
                        .then(d=>{
                            console.log(`[${u}]`, d.ok ? 'Loaded' : 'Fail:', d.error);
                        })
                        .catch(console.error);

                        return window.open(u, '_blank');
                    });

                    // 2. Chờ trong dwellTimeMs – có thể huỷ giữa chừng
                    await new Promise(res => {
                        delayResolver = res;                      // lưu resolve
                        delayTimeout  = setTimeout(res, dwellTimeMs);
                    });

                    // 3. Đóng các tab vừa mở
                    openedTabs.forEach(w => { try { w.close(); } catch(_) {} });
                    openedTabs = [];
                }

                // Hoàn tất – báo cho người dùng (tuỳ chọn)
                const msg = stopRequested ? 'Đã dừng tác vụ.' : 'All URLs have been opened and closed!';
                alert(msg);

                // Khôi phục UI
                openAllBtn.innerHTML = originalText;
                openAllBtn.disabled  = false;
                stopAllBtn.disabled  = true;
                stopAllBtn.innerHTML = '<i class="fas fa-stop me-2"></i>Dừng';
            })();

            // Feedback UI
            const originalText = openAllBtn.innerHTML;
            openAllBtn.innerHTML = '<i class="fas fa-check me-2"></i>Working...';
            openAllBtn.disabled = true;
        });
    }

    // Nút Dừng cho chuỗi "Mở tất cả URL"
    if (stopAllBtn) {
        stopAllBtn.addEventListener('click', function () {
            stopRequested  = true;
            this.disabled  = true;
            this.innerHTML = '<i class="fas fa-check me-2"></i>Đã dừng';

            // Huỷ timeout đang chờ (nếu có) và đóng các tab còn mở
            if (delayTimeout) {
                clearTimeout(delayTimeout);
                delayTimeout = null;
            }
            if (delayResolver) {          // giải phóng Promise ngay
                delayResolver();
                delayResolver = null;
            }
            openedTabs.forEach(w => { try { w.close(); } catch(_) {} });
            openedTabs = [];
        });
    }

    // Nút Dừng cho quá trình quét URL (trong modal)
    if (cancelScanBtn) {
        cancelScanBtn.addEventListener('click', function () {
            loadingModal.hide();        // ẩn modal
            window.location.href = '/'; // quay về trang chủ, hủy chờ phản hồi
        });
    }

    // Handle individual "Open URL" buttons
    openSingleBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const url = this.dataset.url;
            
            if (url) {
                window.open(url, '_blank');

                /* NEW: hỏi server xem trang đã load xong chưa */
                fetch('/check-load',{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({ url })
                })
                .then(r=>r.json())
                .then(data=>{
                    console.log('✓', url, data.ok ? 'đã load xong' : 'lỗi:', data.error);
                })
                .catch(console.error);
                
                // Visual feedback
                const originalIcon = this.innerHTML;
                this.innerHTML = '<i class="fas fa-check"></i>';
                this.style.background = 'linear-gradient(45deg, #2ed573, #7bed9f)';
                this.style.color = 'white';
                this.style.borderColor = '#2ed573';
                
                setTimeout(() => {
                    this.innerHTML = originalIcon;
                    this.style.background = '';
                    this.style.color = '';
                    this.style.borderColor = '';
                }, 1500);
            }
        });
    });

    // Handle clicking on URL links (in addition to the buttons)
    document.querySelectorAll('.url-link').forEach(link => {
        link.addEventListener('click', function(e) {
            // Let the default behavior happen (opening in new tab)
            // but add visual feedback
            const urlItem = this.closest('.url-item');
            if (urlItem) {
                urlItem.style.background = 'linear-gradient(45deg, #e3f2fd, #f3e5f5)';
                urlItem.style.borderColor = '#667eea';
                
                setTimeout(() => {
                    urlItem.style.background = '';
                    urlItem.style.borderColor = '';
                }, 2000);
            }
        });
    });

    // Auto-focus on URL input
    const urlInput = document.getElementById('urlInput');
    if (urlInput) {
        urlInput.focus();
    }

    // Add enter key support for better UX
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.ctrlKey && openAllBtn) {
            // Ctrl+Enter to open all URLs
            openAllBtn.click();
        }
    });

    // Add URL validation and formatting
    const urlInputField = document.getElementById('urlInput');
    if (urlInputField) {
        urlInputField.addEventListener('blur', function() {
            let url = this.value.trim();
            if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
                // Don't auto-add protocol here, let the server handle it
                // This is just for visual feedback
                if (!url.includes('://')) {
                    this.setAttribute('placeholder', `Will scan: https://${url}`);
                }
            }
        });

        urlInputField.addEventListener('focus', function() {
            this.setAttribute('placeholder', 'Enter website URL (e.g., example.com or https://example.com)');
        });
    }

    // Add copy URL functionality (right-click context menu alternative)
    document.querySelectorAll('.url-link').forEach(link => {
        link.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            
            // Copy URL to clipboard
            navigator.clipboard.writeText(this.href).then(() => {
                // Show temporary tooltip
                const tooltip = document.createElement('div');
                tooltip.textContent = 'URL copied to clipboard!';
                tooltip.style.cssText = `
                    position: fixed;
                    top: ${e.clientY - 30}px;
                    left: ${e.clientX}px;
                    background: #333;
                    color: white;
                    padding: 5px 10px;
                    border-radius: 5px;
                    font-size: 12px;
                    z-index: 1000;
                    pointer-events: none;
                `;
                document.body.appendChild(tooltip);
                
                setTimeout(() => {
                    document.body.removeChild(tooltip);
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy URL:', err);
            });
        });
    });

    // Handle page visibility change (when user switches tabs)
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            // Page is hidden - user might be looking at opened tabs
            console.log('User switched away from the scanner page');
        } else {
            // Page is visible again
            console.log('User returned to the scanner page');
        }
    });
}); 