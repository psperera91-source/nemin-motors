// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyC7b4jY21JLuNeYiayKICanQysP5ELNdNg",
    authDomain: "nemin-motores.firebaseapp.com",
    projectId: "nemin-motores",
    storageBucket: "nemin-motores.firebasestorage.app",
    messagingSenderId: "1020795613689",
    appId: "1:1020795613689:web:a8341ec9d277a27d4a4d28",
    measurementId: "G-BV7QWZXMHY"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const fs = firebase.firestore();
const auth = firebase.auth();

// Enable long polling for better connection stability in restricted networks
fs.settings({ experimentalForceLongPolling: true });

console.log("Firebase Initialized with Long Polling.");

// Local DB (Dexie) - Kept for legacy support/migration
const localDb = new Dexie('POS_DB');
localDb.version(3).stores({
    products: '++id, model, serialNumber, processor, ram, storage, price, quantity, cost_price',
    sales: '++id, date, total'
});

// App State
let cart = [];
let currentEditId = null;
let currentThumbnailIndex = 0; // Track which image is the main thumbnail
let currentProductImages = []; // Store current Base64 strings for the modal
let isLoggedIn = false; // Firebase will handle this

// --- Auth System ---
auth.onAuthStateChanged(user => {
    // Check if we have manually authorized this specific tab session
    const isAuthorized = sessionStorage.getItem('isAuthorized') === 'true';

    if (user && isAuthorized) {
        isLoggedIn = true;
        document.getElementById('login-overlay').classList.add('hidden');
        switchTab('dashboard');
    } else {
        isLoggedIn = false;
        // If Firebase thinks we are logged in but session says no, force sign out to be safe
        if (user && !isAuthorized) {
            auth.signOut();
        }
        document.getElementById('login-overlay').classList.remove('hidden');
        document.getElementById('login-username').focus();
    }
});

function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    // For a simple POS, we can use a hardcoded email/password to sign in to Firebase
    // Or just use Anonymous auth if it's for trial. 
    // Let's use Email/Pass with a dummy email for now or ask user to setup.
    // To make it work IMMEDIATELY without complex setup, I'll use a local check + persistent flag if they don't have Auth enabled yet.
    // BUT since we are doing Firebase, let's suggest the user to enable "Anonymous Auth" first.

    if (user === 'admin' && pass === '4560') {
        // Set persistence to SESSION
        auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
            .then(() => {
                // Mark as authorized in THIS tab session
                sessionStorage.setItem('isAuthorized', 'true');
                return auth.signInAnonymously();
            })
            .catch(err => {
                console.error("Firebase Auth Error:", err);
                errorEl.innerText = "Firebase Error: " + err.message;
                errorEl.classList.remove('hidden');
            });

        // Clear fields
        document.getElementById('login-password').value = '';
    } else {
        errorEl.classList.remove('hidden');
        setTimeout(() => errorEl.classList.add('hidden'), 3000);
    }
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        sessionStorage.removeItem('isAuthorized');
        auth.signOut();
    }
}

let cachedSales = []; // Store history sales in memory for sync reprinting

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    sales: document.getElementById('view-sales'),
    inventory: document.getElementById('view-inventory'),
    history: document.getElementById('view-history'),
    agreements: document.getElementById('view-agreements')
};
const navs = {
    dashboard: document.getElementById('nav-dashboard'),
    sales: document.getElementById('nav-sales'),
    inventory: document.getElementById('nav-inventory'),
    history: document.getElementById('nav-history'),
    agreements: document.getElementById('nav-agreements')
};

// --- Navigation ---
function switchTab(tabName) {
    // Hide all views
    Object.values(views).forEach(el => el.classList.add('hidden'));
    Object.values(navs).forEach(el => {
        el.classList.remove('bg-rose-600', 'shadow-lg', 'shadow-rose-900/50', 'active-tab', 'text-white');
        el.classList.add('text-slate-300'); // Default inactive
        // Reset icon colors
        const icon = el.querySelector('i');
        if (icon) {
            icon.classList.remove('text-blue-300');
            icon.classList.add('text-slate-400');
        }
    });

    // Show selected
    views[tabName].classList.remove('hidden');
    navs[tabName].classList.add('bg-rose-600', 'shadow-lg', 'shadow-rose-900/50', 'active-tab', 'text-white');
    navs[tabName].classList.remove('text-slate-300');

    // Update icon
    const activeIcon = navs[tabName].querySelector('i');
    if (activeIcon) {
        activeIcon.classList.remove('text-slate-400');
        activeIcon.classList.add('text-rose-300');
    }

    document.getElementById('page-title').innerText = tabName.charAt(0).toUpperCase() + tabName.slice(1);

    if (tabName === 'dashboard') loadDashboard();
    if (tabName === 'inventory') loadInventory();
    if (tabName === 'history') loadHistory();
    if (tabName === 'sales') loadSalesGrid();
    if (tabName === 'agreements') loadAgreements();

    // Mobile: Close sidebar if open
    if (window.innerWidth < 1024) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            sidebar.classList.add('-translate-x-full');
            if (overlay) overlay.classList.add('hidden');
        }
    }
}

// --- Helpers ---
function getDisplayId(sale) {
    if (!sale) return '??';
    if (sale.invoiceNo) {
        return String(sale.invoiceNo).padStart(2, '0');
    }
    const id = sale.id || (typeof sale === 'string' ? sale : '');
    if (!id) return '00';
    return id.length > 10 ? id.substring(0, 7).toUpperCase() : String(id).padStart(2, '0');
}

// --- Dashboard Logic ---

async function loadDashboard() {
    try {
        // Fetch from Firestore (No orderBy here to avoid index errors)
        const productsSnap = await fs.collection('nm_products').get();
        const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const salesSnap = await fs.collection('nm_sales').get();
        let sales = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort client-side
        sales.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 1. Core Stats
        let totalRevenue = 0;
        let totalProfit = 0;

        sales.forEach(s => {
            const netTotal = s.total || 0;
            totalRevenue += netTotal;

            let saleCost = 0;
            if (s.items) {
                s.items.forEach(item => {
                    // Profit = (Selling Price * Qty) - (Cost Price * Qty)
                    // Note: We use the cost_price stored in the item at the time of sale
                    saleCost += (item.cost_price || 0) * (item.cartQty || 1);
                });
            }

            // Calculate profit for this sale: Total Revenue - Discount - Total Cost
            // Since s.total already has discount subtracted:
            totalProfit += (netTotal - saleCost);
        });

        const totalProducts = products.reduce((sum, p) => sum + (p.quantity || 0), 0);
        const lowStockCount = products.filter(p => p.quantity <= 3).length;

        document.getElementById('dash-revenue').innerText = 'LKR ' + Number(totalRevenue).toLocaleString();
        document.getElementById('dash-profit').innerText = 'LKR ' + Number(totalProfit).toLocaleString();
        document.getElementById('dash-products').innerText = totalProducts;
        document.getElementById('dash-sales-count').innerText = sales.length;
        document.getElementById('dash-low-stock').innerText = lowStockCount;

        // 2. Recent Activity
        const recentActivity = document.getElementById('dash-recent-sales');
        const recentSales = sales.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

        if (recentSales.length > 0) {
            recentActivity.innerHTML = recentSales.map(s => {
                const itemCount = s.items ? s.items.length : 0;
                const saleDate = s.date ? new Date(s.date) : new Date();
                const displayId = getDisplayId(s);

                return `
            <div class="flex justify-between items-center p-3 hover:bg-gray-50 rounded-xl transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs">
                        #${displayId}
                    </div>
                    <div>
                        <p class="text-sm font-bold text-gray-800">${itemCount} Items Purchased</p>
                        <p class="text-xs text-gray-500">${saleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${saleDate.toLocaleDateString()}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-sm font-bold text-blue-600">LKR ${Number(s.total || 0).toLocaleString()}</p>
                    <p class="text-xs text-green-500 font-medium italic">Paid</p>
                </div>
            </div>`;
            }).join('');
        } else {
            recentActivity.innerHTML = '<p class="text-gray-400 text-sm italic py-4 text-center">No recent activity.</p>';
        }

        // 3. Daily Revenue Breakdown (Last 7 Days)
        const dailyRevenueContainer = document.getElementById('dash-daily-revenue');
        const dailyStats = {};

        // Group sales by date
        sales.forEach(s => {
            const dateKey = new Date(s.date).toLocaleDateString();
            if (!dailyStats[dateKey]) dailyStats[dateKey] = 0;
            dailyStats[dateKey] += s.total || 0;
        });

        // Get last 7 days in order
        const today = new Date();
        const last7Days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            last7Days.push(d.toLocaleDateString());
        }

        if (sales.length > 0) {
            dailyRevenueContainer.innerHTML = last7Days.map(dateStr => {
                const amount = dailyStats[dateStr] || 0;
                // Also calculate daily profit for the bar charts if needed, 
                // but for now we'll stick to revenue for the progress bars
                const percentage = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0;
                const isToday = dateStr === today.toLocaleDateString();

                return `
                <div class="flex flex-col gap-1">
                    <div class="flex justify-between items-end text-sm">
                        <span class="font-medium ${isToday ? 'text-blue-600 font-bold' : 'text-gray-600'}">${isToday ? 'Today' : dateStr}</span>
                        <span class="font-bold text-gray-900">LKR ${Number(amount).toLocaleString()}</span>
                    </div>
                    <div class="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div class="bg-emerald-500 h-full transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" style="width: ${Math.max(percentage, amount > 0 ? 5 : 0)}%"></div>
                    </div>
                </div>
            `;
            }).join('');
        } else {
            dailyRevenueContainer.innerHTML = '<p class="text-gray-400 text-sm italic py-4 text-center">No sales data yet.</p>';
        }

        // 4. Most Sold Items & Profit Breakdown
        const itemSales = {};
        sales.forEach(s => {
            // Fallback for subtotal if it doesn't exist in the sale object
            const items = s.items || [];
            const saleSubtotal = s.subtotal || items.reduce((sum, item) => sum + (item.price * (item.cartQty || 1)), 0);
            const saleDiscount = s.discount || 0;

            items.forEach(item => {
                const model = item.model || "Unknown Item";
                if (!itemSales[model]) itemSales[model] = { qty: 0, revenue: 0, profit: 0 };

                const qty = item.cartQty || 1;
                const itemGrossRevenue = item.price * qty;
                const itemCost = (item.cost_price || 0) * qty;

                // Distribute discount proportionally
                let itemDiscount = 0;
                if (saleSubtotal > 0) {
                    itemDiscount = (itemGrossRevenue / saleSubtotal) * saleDiscount;
                }

                const itemNetRevenue = itemGrossRevenue - itemDiscount;
                const itemProfit = itemNetRevenue - itemCost;

                itemSales[model].qty += qty;
                itemSales[model].revenue += itemGrossRevenue; // Keep gross revenue for the "Total Sold" label
                itemSales[model].profit += itemProfit;
            });
        });

        const topItems = Object.entries(itemSales)
            .sort((a, b) => b[1].qty - a[1].qty)
            .slice(0, 10);

        const topProductContainer = document.getElementById('dash-top-products');
        if (topItems.length > 0) {
            topProductContainer.innerHTML = topItems.map(([model, data]) => {
                const margin = data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0;
                return `
                <div class="flex flex-col p-3 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-100 group">
                    <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-bold">
                                ${data.qty}
                            </div>
                            <p class="text-sm font-bold text-gray-800 group-hover:text-blue-600 transition-colors capitalize">${model}</p>
                        </div>
                        <p class="text-sm font-bold text-emerald-600" title="Net Profit">
                            <span class="text-[10px] text-gray-400 font-normal mr-1">Profit:</span> LKR ${Number(data.profit).toLocaleString()}
                        </p>
                    </div>
                    <div class="flex justify-between items-center ml-11">
                        <p class="text-xs text-gray-500">Total Sold: LKR ${Number(data.revenue).toLocaleString()}</p>
                        <div class="h-1.5 w-24 bg-gray-100 rounded-full overflow-hidden">
                            <div class="bg-emerald-400 h-full" style="width: ${Math.max(0, Math.min(margin, 100))}%"></div>
                        </div>
                    </div>
                </div>
            `;
            }).join('');
        } else {
            topProductContainer.innerHTML = '<p class="text-gray-400 text-sm italic py-4 text-center">No sales data yet.</p>';
        }
    } catch (error) {
        console.error("Dashboard Load Error:", error);
        document.getElementById('dash-recent-sales').innerHTML = '<p class="text-red-400 text-sm text-center">Failed to load dashboard data.</p>';
    }
}

// --- Inventory Management ---

async function loadInventory() {
    const productsSnap = await fs.collection('nm_products').get();
    const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const tbody = document.getElementById('inventory-table-body');
    const search = document.getElementById('inventory-search').value.toLowerCase();

    tbody.innerHTML = '';

    const filtered = products.filter(p =>
        p.model.toLowerCase().includes(search) ||
        (p.serialNumber && p.serialNumber.toLowerCase().includes(search)) ||
        (p.processor && p.processor.toLowerCase().includes(search))
    ).sort((a, b) => {
        // Sort: Has Stock (1) > No Stock (0)
        const aStock = a.quantity > 0 ? 1 : 0;
        const bStock = b.quantity > 0 ? 1 : 0;
        // If stock status is different, prioritize in-stock
        if (bStock !== aStock) return bStock - aStock;
        // If both have stock or both don't, sort by model name
        return a.model.localeCompare(b.model);
    });

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50/50 transition-colors border-b border-gray-100 group align-top cursor-pointer";
        tr.onclick = (e) => {
            // Don't toggle if clicking buttons or checkboxes
            if (e.target.closest('button') || e.target.closest('input')) return;
            const descRow = tr.nextElementSibling;
            descRow.classList.toggle('hidden');
            const icon = tr.querySelector('.expand-icon');
            if (icon) icon.classList.toggle('rotate-180');
        };
        tr.innerHTML = `
                <td class="px-6 py-4">
                    <input type="checkbox" onchange="toggleInventoryRow()" value="${p.id}" class="inventory-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500">
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <i class="fa-solid fa-chevron-down text-[10px] text-gray-400 expand-icon transition-transform"></i>
                        
                        <!-- Thumbnail -->
                        <div class="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
                            ${p.imageUrl
                ? `<img src="${p.imageUrl}" class="w-full h-full object-cover">`
                : `<i class="fa-solid fa-laptop text-gray-400 text-xs"></i>`
            }
                        </div>

                        <div>
                            <div class="font-bold text-gray-900 text-base">${p.model}</div>
                            <div class="flex items-center gap-2 mt-0.5">
                                <span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold uppercase">${p.category || 'Bike'}</span>
                                ${p.serialNumber ? `<span class="text-[10px] text-gray-400 font-mono tracking-wider uppercase">EN: ${p.serialNumber}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="mt-2 inline-flex items-center px-2 py-1 rounded bg-gray-100 text-xs font-medium text-gray-800 ml-16">
                        <i class="fa-solid fa-tag w-3 text-gray-500"></i> ${p.conditions || '-'}
                    </div>
                </td>
                <td class="px-6 py-4">
                     <span class="${p.quantity > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'} px-2 py-1 rounded-full text-xs font-medium border ${p.quantity > 0 ? 'border-green-100' : 'border-red-100'}">
                        ${p.quantity} Left
                    </span>
                </td>
                <td class="px-6 py-4 text-right font-medium text-slate-500 italic">LKR ${Number(p.cost_price || 0).toLocaleString()}</td>
                <td class="px-6 py-4 text-right font-bold text-gray-900 text-base">LKR ${Number(p.price).toLocaleString()}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center flex-col gap-2">
                        <button onclick="editProduct('${p.id}')" class="px-3 py-1 bg-white border border-gray-200 text-blue-600 hover:bg-blue-50 hover:border-blue-200 rounded-lg transition-all text-xs font-medium flex items-center justify-center gap-2">
                            <i class="fa-solid fa-pen"></i> Edit
                        </button>
                        <button onclick="deleteProduct('${p.id}')" class="px-3 py-1 bg-white border border-gray-200 text-red-600 hover:bg-red-50 hover:border-red-200 rounded-lg transition-all text-xs font-medium flex items-center justify-center gap-2">
                            <i class="fa-solid fa-trash"></i> Delete
                        </button>
                    </div>
                </td>
            `;

        const detailTr = document.createElement('tr');
        detailTr.className = "hidden bg-gray-50/50 border-b border-gray-100";
        detailTr.innerHTML = `
                <td></td>
                <td colspan="5" class="px-6 py-6">
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-x-12 gap-y-4 text-sm">
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-motorcycle w-5 text-rose-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Engine</span> <span class="text-gray-600">${p.processor || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-gauge w-5 text-green-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Mileage</span> <span class="text-gray-600">${p.ram || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-gas-pump w-5 text-amber-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Fuel Type</span> <span class="text-gray-600">${p.storage || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-gear w-5 text-orange-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Transmission</span> <span class="text-gray-600">${p.graphics || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-palette w-5 text-teal-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Color</span> <span class="text-gray-600">${p.display || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-calendar w-5 text-blue-400 pt-1"></i> <div><span class="block font-bold text-gray-900">Year</span> <span class="text-gray-600">${p.os || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-address-card w-5 text-slate-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Plate #</span> <span class="text-gray-600">${p.ports || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-hashtag w-5 text-emerald-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Chassis #</span> <span class="text-gray-600">${p.battery_life || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-box-open w-5 text-amber-600 pt-1"></i> <div><span class="block font-bold text-gray-900">Features</span> <span class="text-gray-600">${p.included_items || '-'}</span></div></div>
                        <div class="flex gap-3 items-start"><i class="fa-solid fa-barcode w-5 text-gray-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Engine Number</span> <span class="text-gray-600">${p.serialNumber || '-'}</span></div></div>
                        <div class="col-span-full mt-2 pt-4 border-t border-gray-200">
                             <div class="flex gap-3 items-start"><i class="fa-solid fa-shield-halved w-5 text-red-500 pt-1"></i> <div><span class="block font-bold text-gray-900">Warranty Details</span> <span class="text-gray-600">${p.warranty || '-'}</span></div></div>
                        </div>
                    </div>
                </td>
            `;
        tbody.appendChild(tr);
        tbody.appendChild(detailTr);
    });

    // Reset Bulk UI
    const master = document.getElementById('inventory-select-all');
    if (master) master.checked = false;
    const btn = document.getElementById('bulk-delete-inv-btn');
    if (btn) btn.classList.add('hidden');
}

function toggleAllInventory() {
    const master = document.getElementById('inventory-select-all');
    const boxes = document.querySelectorAll('.inventory-checkbox');
    boxes.forEach(box => box.checked = master.checked);
    toggleInventoryRow();
}

function toggleInventoryRow() {
    const boxes = document.querySelectorAll('.inventory-checkbox:checked');
    const btn = document.getElementById('bulk-delete-inv-btn');
    if (boxes.length > 0) {
        btn.classList.remove('hidden');
        btn.innerHTML = `<i class="fa-solid fa-trash"></i> Delete (${boxes.length})`;
    } else {
        btn.classList.add('hidden');
        const master = document.getElementById('inventory-select-all');
        if (master) master.checked = false;
    }
}

async function deleteSelectedInventory() {
    const boxes = document.querySelectorAll('.inventory-checkbox:checked');
    if (boxes.length === 0) return;

    if (confirm(`Are you sure you want to delete ${boxes.length} products?`)) {
        const batch = fs.batch();
        boxes.forEach(box => {
            const docRef = fs.collection('nm_products').doc(box.value);
            batch.delete(docRef);
        });
        await batch.commit();
        loadInventory();
        loadSalesGrid();
    }
}




function closeProductModal() {
    document.getElementById('product-modal-panel').classList.add('translate-x-full');
    setTimeout(() => {
        document.getElementById('product-modal').classList.add('hidden');
    }, 300);
}

async function exportInventoryToExcel() {
    try {
        const snap = await fs.collection('nm_products').get();
        const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (products.length === 0) {
            alert("No inventory data to export!");
            return;
        }

        // Format data for Excel
        const data = products.map(p => ({
            'ID': p.id,
            'Bike Model': p.model,
            'Condition': p.conditions || '-',
            'Cost Price (LKR)': p.cost_price || 0,
            'Selling Price (LKR)': p.price || 0,
            'Stock Quantity': p.quantity || 0,
            'Engine Capacity': p.processor || '-',
            'Mileage': p.ram || '-',
            'Fuel Type': p.storage || '-',
            'Transmission': p.graphics || '-',
            'Plate Number': p.ports || '-',
            'Chassis Number': p.battery_life || '-',
            'Engine Number': p.serialNumber || '-',
            'Warranty': p.warranty || '-'
        }));

        // Create Worksheet
        const ws = XLSX.utils.json_to_sheet(data);

        // Create Workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inventory");

        // Generate File
        const fileName = `Nemin_Motors_Inventory_Backup_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);

    } catch (error) {
        console.error("Export failed:", error);
        alert("Failed to export Excel sheet.");
    }
}

async function exportInventoryToJSON() {
    try {
        const snap = await fs.collection('nm_products').get();
        const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const blob = new Blob([JSON.stringify(products, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Nemin_Motors_Inventory_JSON_Backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert("JSON Export failed");
    }
}

async function importInventory(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split('.').pop().toLowerCase();

    reader.onload = async (e) => {
        try {
            const data = e.target.result;
            let importedProducts = [];

            if (extension === 'json') {
                importedProducts = JSON.parse(data);
            } else if (extension === 'xlsx' || extension === 'xls') {
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                // Map Excel headers back to DB schema
                importedProducts = jsonData.map(row => ({
                    model: row['Bike Model'] || row['model'] || 'Unknown Model',
                    cost_price: parseFloat(row['Cost Price (LKR)'] || row['cost_price'] || 0),
                    price: parseFloat(row['Selling Price (LKR)'] || row['price'] || 0),
                    quantity: parseInt(row['Stock Quantity'] || row['quantity'] || 0),
                    processor: row['Engine Capacity'] || row['processor'] || '',
                    ram: row['Mileage'] || row['ram'] || '',
                    storage: row['Fuel Type'] || row['storage'] || '',
                    graphics: row['Transmission'] || row['graphics'] || '',
                    display: row['Color'] || row['display'] || '',
                    os: row['Year'] || row['os'] || '',
                    conditions: row['Condition'] || row['conditions'] || 'Brand New',
                    warranty: row['Warranty'] || row['warranty'] || '',
                    battery_life: row['Chassis Number'] || row['battery_life'] || '',
                    serialNumber: row['Engine Number'] || row['serialNumber'] || '',
                    item_description: row['Bike Model'] || row['model'] || ''
                }));
            }

            if (Array.isArray(importedProducts) && importedProducts.length > 0) {
                if (confirm(`Import ${importedProducts.length} items? This will add them to your current inventory.`)) {
                    // Remove IDs to avoid collisions and let Dexie auto-increment
                    const cleanedProducts = importedProducts.map(p => {
                        const { id, ...rest } = p;
                        return rest;
                    });

                    await localDb.products.bulkAdd(cleanedProducts);
                    alert("Import successful!");
                    loadInventory();
                    loadSalesGrid();
                    loadDashboard();
                }
            } else {
                alert("No valid product data found in the file.");
            }
        } catch (error) {
            console.error("Import failed:", error);
            alert("Failed to import data. Please ensure the file is a valid JSON or Excel backup.");
        }
        event.target.value = ''; // Reset input
    };

    if (extension === 'json') {
        reader.readAsText(file);
    } else {
        reader.readAsBinaryString(file);
    }
}

// Image Preview Listener
document.getElementById('product-image').addEventListener('change', async function (e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Show loading state
    const container = document.getElementById('image-previews');
    container.innerHTML = '<div class="text-xs text-slate-400 p-4"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Processing images...</div>';

    const newImages = [];
    for (let file of files) {
        try {
            const b64 = await resizeImage(file);
            newImages.push(b64);
        } catch (err) {
            console.error("Error processing file:", err);
        }
    }

    currentProductImages = newImages;
    currentThumbnailIndex = 0; // Default to first new image
    renderImagePreviews();
});

function renderImagePreviews() {
    const container = document.getElementById('image-previews');
    container.innerHTML = '';

    if (currentProductImages.length === 0) {
        container.innerHTML = `
            <div class="relative w-24 h-24 bg-white rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center shrink-0">
                <i class="fa-solid fa-image text-gray-300 text-3xl"></i>
            </div>
        `;
        return;
    }

    currentProductImages.forEach((url, index) => {
        const isMain = index === currentThumbnailIndex;
        const div = document.createElement('div');
        div.className = `relative w-24 h-24 bg-white rounded-lg overflow-hidden border-2 cursor-pointer transition-all shrink-0 ${isMain ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200 hover:border-blue-300'}`;
        div.onclick = () => {
            currentThumbnailIndex = index;
            renderImagePreviews();
        };

        div.innerHTML = `
            <img src="${url}" class="w-full h-full object-cover">
            ${isMain ? `
                <div class="absolute top-0 left-0 bg-blue-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-br-lg shadow-sm">
                    MAIN
                </div>
                <div class="absolute inset-0 bg-blue-500/5"></div>
            ` : ''}
        `;
        container.appendChild(div);
    });
}

// Helper: Resize Image and Convert to Base64 (Optimized for speed)
function resizeImage(file, maxWidth = 480, quality = 0.4) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function saveProduct() {
    const form = document.getElementById('product-form');
    if (!form) return;

    const elements = form.elements;
    const model = (elements['model'] ? elements['model'].value : '').trim();
    const price = elements['price'] ? elements['price'].value : '';
    const quantity = elements['quantity'] ? elements['quantity'].value : '';

    if (!model || !price || !quantity) {
        alert("Please fill required fields (Model, Price, Quantity)");
        return;
    }

    const saveBtn = document.querySelector('#product-modal button[onclick="saveProduct()"]');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = "Processing...";
    }

    try {
        // Filter out any empty/null images
        const imageUrls = (currentProductImages || []).filter(img => img && img.startsWith('data:image'));

        const productData = {
            category: elements['category'] ? elements['category'].value : 'Bike',
            model: model,
            item_description: model,
            price: parseFloat(price) || 0,
            cost_price: parseFloat(elements['cost_price'] ? elements['cost_price'].value : '0') || 0,
            quantity: parseInt(quantity) || 0,
            processor: (elements['processor'] ? elements['processor'].value : '').trim(),
            ram: (elements['ram'] ? elements['ram'].value : '').trim(),
            storage: (elements['storage'] ? elements['storage'].value : '').trim(),
            graphics: (elements['graphics'] ? elements['graphics'].value : '').trim(),
            display: (elements['display'] ? elements['display'].value : '').trim(),
            os: (elements['os'] ? elements['os'].value : '').trim(),
            ports: (elements['ports'] ? elements['ports'].value : '').trim(),
            battery_life: (elements['battery_life'] ? elements['battery_life'].value : '').trim(),
            conditions: elements['conditions'] ? elements['conditions'].value : 'Brand New',
            included_items: (elements['included_items'] ? elements['included_items'].value : '').trim(),
            serialNumber: (elements['serialNumber'] ? elements['serialNumber'].value : '').trim(),
            warranty: (elements['warranty'] ? elements['warranty'].value : '').trim(),
            imageUrl: imageUrls[currentThumbnailIndex] || (imageUrls.length > 0 ? imageUrls[0] : null),
            imageUrls: imageUrls,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Safety check: Firestore document limit is 1MB. 
        const docSize = JSON.stringify(productData).length;
        if (docSize > 900000) {
            throw new Error("Product data (including images) is too large. try fewer or smaller images.");
        }

        const savePromise = currentEditId
            ? fs.collection('nm_products').doc(currentEditId).update(productData)
            : fs.collection('nm_products').add({ ...productData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });

        // Add a timeout because Firestore hangs if rules are wrong or connection is lost
        await Promise.race([
            savePromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout: Firebase is not responding. Please check your internet or Firebase Rules.")), 15000))
        ]);

        closeProductModal();
        loadInventory();
        loadSalesGrid();
        alert("Product saved successfully!");

    } catch (error) {
        console.error("Save Error:", error);
        let msg = error.message;
        if (msg.includes("permission-denied")) {
            msg = "Permission Denied. Please ensure your Firestore Rules are set to 'allow read, write: if true;' in the Firebase Console.";
        }
        alert("Failed to save: " + msg);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Details";
        }
    }
}

// Update openProductModal to reset image state
function openProductModal() {
    document.getElementById('product-modal').classList.remove('hidden');
    document.getElementById('product-modal-panel').classList.remove('translate-x-full');
    currentEditId = null;
    currentThumbnailIndex = 0;
    currentProductImages = [];
    document.getElementById('product-form').reset();

    // Reset Image Preview
    renderImagePreviews();
    document.getElementById('upload-progress-container').classList.add('hidden');

    document.getElementById('modal-title').innerText = "Add New Product";
}

async function editProduct(id) {
    const doc = await fs.collection('nm_products').doc(id).get();
    if (!doc.exists) return;
    const product = { id: doc.id, ...doc.data() };

    currentEditId = id;
    const form = document.getElementById('product-form');

    // Fill form
    form.category.value = product.category || 'Laptop';
    form.model.value = product.model;
    form.cost_price.value = product.cost_price || 0;
    form.price.value = product.price;
    form.quantity.value = product.quantity;
    form.processor.value = product.processor || '';
    form.ram.value = product.ram || '';
    form.storage.value = product.storage || '';
    form.graphics.value = product.graphics || '';
    form.display.value = product.display || '';
    form.os.value = product.os || '';
    form.ports.value = product.ports || '';
    form.battery_life.value = product.battery_life || '';
    form.conditions.value = product.conditions || 'Brand New';
    form.included_items.value = product.included_items || '';
    form.serialNumber.value = product.serialNumber || '';
    form.warranty.value = product.warranty || '';

    // Show Image Previews
    currentProductImages = product.imageUrls && product.imageUrls.length > 0 ? product.imageUrls : (product.imageUrl ? [product.imageUrl] : []);

    // Find the current thumbnail index
    currentThumbnailIndex = product.imageUrl ? currentProductImages.indexOf(product.imageUrl) : 0;
    if (currentThumbnailIndex === -1) currentThumbnailIndex = 0;

    renderImagePreviews();

    document.getElementById('modal-title').innerText = "Edit Product";
    document.getElementById('product-modal').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('product-modal-panel').classList.remove('translate-x-full');
    }, 10);
}

async function deleteProduct(id) {
    if (confirm('Are you sure you want to delete this product?')) {
        await fs.collection('nm_products').doc(id).delete();
        loadInventory();
        loadSalesGrid();
    }
}

// --- Sales Management ---

async function loadSalesGrid() {
    const snap = await fs.collection('nm_products').get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const grid = document.getElementById('product-grid');
    const search = document.getElementById('sales-search').value.toLowerCase();

    grid.innerHTML = '';

    const filtered = products.filter(p =>
        p.quantity > 0 &&
        (p.model.toLowerCase().includes(search) ||
            (p.serialNumber && p.serialNumber.toLowerCase().includes(search)) ||
            (p.processor && p.processor.toLowerCase().includes(search)))
    );

    filtered.forEach(p => {
        const div = document.createElement('div');
        div.className = "bg-white p-4 rounded-xl border border-gray-100 hover:shadow-md transition-all cursor-pointer group mb-3 relative overflow-hidden";
        div.onclick = () => addToCart(p);

        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-gray-800 pr-8 group-hover:text-blue-600 transition-colors">${p.model}</h4>
                <span class="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-md font-medium">Qty: ${p.quantity}</span>
            </div>
            
            <div class="text-xs text-gray-500 space-y-1 mb-3">
                <p><i class="fa-solid fa-microchip w-4"></i> ${p.processor || 'N/A'}</p>
                <div class="flex gap-2">
                    <span class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">${p.ram || 'N/A'}</span>
                    <span class="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100">${p.storage || 'N/A'}</span>
                </div>
            </div>
            
            <div class="flex justify-between items-end mt-2 pt-2 border-t border-gray-50">
                <span class="font-bold text-blue-600 text-lg">LKR ${Number(p.price).toLocaleString()}</span>
                <button class="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-110 transition-transform">
                    <i class="fa-solid fa-plus font-bold"></i>
                </button>
            </div>
        `;
        grid.appendChild(div);
    });
}

function addToCart(product) {
    const existing = cart.find(c => c.id === product.id);
    if (existing) {
        if (existing.cartQty < product.quantity) {
            existing.cartQty++;
        } else {
            alert("Not enough stock!");
        }
    } else {
        cart.push({ ...product, cartQty: 1 });
    }
    renderCart();
}

function removeFromCart(id) {
    cart = cart.filter(c => c.id !== id);
    renderCart();
}

function updateCartQty(id, change) {
    const item = cart.find(c => c.id === id);
    if (item) {
        const newQty = item.cartQty + change;
        if (newQty > 0 && newQty <= item.quantity) {
            item.cartQty = newQty;
        } else if (newQty <= 0) {
            removeFromCart(id);
            return;
        }
    }
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items');
    container.innerHTML = '';
    let total = 0;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-10 flex flex-col items-center">
                <i class="fa-solid fa-basket-shopping text-4xl mb-3 text-gray-300"></i>
                <p>Cart is empty</p>
                <p class="text-xs mt-1">Select items from the list</p>
            </div>
        `;
    }

    cart.forEach(item => {
        const itemTotal = item.price * item.cartQty;
        total += itemTotal;

        const div = document.createElement('div');
        div.className = "bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex items-start gap-3 animate-fade-in";
        div.innerHTML = `
            <div class="flex-1">
                <h5 class="text-sm font-bold text-gray-800 line-clamp-1">${item.model}</h5>
                <p class="text-xs text-blue-600 font-semibold mt-0.5">LKR ${Number(item.price).toLocaleString()}</p>
            </div>
            
            <div class="flex flex-col items-end gap-2">
                <div class="flex items-center gap-2 bg-gray-50 rounded-lg p-1 border border-gray-200">
                    <button onclick="updateCartQty(${item.id}, -1)" class="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-white hover:text-red-500 hover:shadow-sm rounded transition-all">
                        <i class="fa-solid fa-minus text-xs"></i>
                    </button>
                    <span class="text-xs font-bold w-4 text-center">${item.cartQty}</span>
                    <button onclick="updateCartQty(${item.id}, 1)" class="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-white hover:text-green-500 hover:shadow-sm rounded transition-all">
                        <i class="fa-solid fa-plus text-xs"></i>
                    </button>
                </div>
                <p class="text-xs font-bold text-gray-700">LKR ${Number(itemTotal).toLocaleString()}</p>
            </div>
        `;
        container.appendChild(div);
    });



    // Update Mobile Badge
    const badge = document.getElementById('cart-count-badge');
    const totalQty = cart.reduce((sum, item) => sum + item.cartQty, 0);
    if (badge) {
        if (totalQty > 0) {
            badge.innerText = totalQty;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    calculateTotals();
}

function toggleMobileCart() {
    const cartEl = document.getElementById('cart-container');
    cartEl.classList.toggle('translate-x-full');
}

function calculateTotals() {
    let subtotal = 0;
    cart.forEach(item => subtotal += item.price * item.cartQty);

    const discountInput = document.getElementById('cart-discount');
    let discount = parseFloat(discountInput.value) || 0;

    // Prevent discount > subtotal
    if (discount > subtotal) {
        discount = subtotal;
        discountInput.value = discount;
    }

    const total = subtotal - discount;

    document.getElementById('cart-subtotal').innerText = 'LKR ' + Number(subtotal).toLocaleString();
    document.getElementById('cart-total').innerText = 'LKR ' + Number(total).toLocaleString();

    return { subtotal, discount, total };
}

let lastSaleDetails = null;

// --- Checkout & Bill ---

async function processCheckout() {
    if (cart.length === 0) {
        alert("Cart is empty!");
        return;
    }

    const checkoutBtn = document.querySelector('#view-sales button[onclick="processCheckout()"]');
    const originalContent = checkoutBtn.innerHTML;
    checkoutBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    checkoutBtn.disabled = true;

    const { subtotal, discount, total } = calculateTotals();
    const saleDate = new Date().toISOString();

    try {
        const counterRef = fs.collection('nm_settings').doc('counters');
        const saleRef = fs.collection('nm_sales').doc();
        let finalInvoiceNo = 1;
        let saleData;

        await fs.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            finalInvoiceNo = (counterDoc.exists ? (counterDoc.data().invoiceCount || 0) : 0) + 1;

            saleData = {
                invoiceNo: finalInvoiceNo,
                date: saleDate,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                subtotal: subtotal,
                discount: discount,
                total: total,
                items: JSON.parse(JSON.stringify(cart))
            };

            transaction.set(counterRef, { invoiceCount: finalInvoiceNo }, { merge: true });
            transaction.set(saleRef, saleData);

            for (const item of cart) {
                const productRef = fs.collection('nm_products').doc(item.id);
                transaction.update(productRef, {
                    quantity: firebase.firestore.FieldValue.increment(-item.cartQty)
                });
            }
        });

        const saleId = saleRef.id;
        console.log("Transaction committed. Sale ID:", saleId);

        lastSaleDetails = { id: saleId, ...saleData };
        localStorage.setItem('lastSale', JSON.stringify(lastSaleDetails));

        // Clear Cart
        cart = [];
        document.getElementById('cart-discount').value = 0;
        renderCart(); // This also updates mobile badge
        loadSalesGrid();

        // Close mobile cart panel if open
        const mobileCartBody = document.getElementById('mobile-cart-body');
        if (mobileCartBody && !mobileCartBody.parentElement.classList.contains('hidden')) {
            toggleMobileCart();
        }

        // Automatically trigger Print dialog directly
        printBill(
            saleId,
            saleData.subtotal,
            saleData.discount,
            saleData.total,
            saleData.items,
            saleData.invoiceNo
        );

    } catch (error) {
        console.error("Checkout failed:", error);
        alert("Transaction failed! Firestore rules check karanna. Error: " + error.message);
    } finally {
        checkoutBtn.innerHTML = originalContent;
        checkoutBtn.disabled = false;
    }
}

function printLastBill() {
    if (!lastSaleDetails) {
        // Try formatted from localStorage
        const stored = localStorage.getItem('lastSale');
        if (stored) {
            lastSaleDetails = JSON.parse(stored);
        } else {
            return;
        }
    }
    printBill(
        lastSaleDetails.id,
        lastSaleDetails.subtotal,
        lastSaleDetails.discount,
        lastSaleDetails.total,
        lastSaleDetails.items,
        lastSaleDetails.invoiceNo
    );
}

function checkLastBill() {
    const stored = localStorage.getItem('lastSale');
    if (stored) {
        lastSaleDetails = JSON.parse(stored);
    }
}

function printBill(id, subtotal, discount, total, items, invoiceNo = null) {
    const billItems = document.getElementById('bill-items-container');
    const billTotal = document.getElementById('bill-total');
    const billId = document.getElementById('bill-id');
    const billDate = document.getElementById('bill-date');

    // Reset
    billItems.innerHTML = '';

    // Set Header Info
    const displayId = getDisplayId({ id, invoiceNo });
    billId.innerText = `#${displayId}`;
    billDate.innerText = new Date().toLocaleDateString('en-GB');

    // Add items strictly as requested: "Laptop model, processor, ram, storage, warrnty"
    const safeItems = items || [];
    if (safeItems.length === 0) {
        console.warn("Printing bill with empty items list.");
    }

    safeItems.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="pt-2 pb-2 mr-2">
                <div class="font-bold text-base overflow-hidden">${item.model}</div>
                <div class="text-xs text-gray-600 mt-1 pl-1">
                   ${item.serialNumber ? `<span class="font-bold text-blue-800">SN: ${item.serialNumber}</span><br>` : ''}
                   ${item.processor ? `• ${item.processor}` : ''} <br>
                   ${item.ram ? `• ${item.ram}` : ''} | ${item.storage ? `${item.storage}` : ''} <br>
                   ${item.warranty ? `• Warranty: ${item.warranty}` : ''}
                </div>
            </td>
            <td class="pt-2 text-right align-top font-medium">
                ${item.cartQty} x ${Number(item.price).toLocaleString()}
                <br>
                <div class="font-bold mt-1">LKR ${Number(item.price * item.cartQty).toLocaleString()}</div>
            </td>
        `;
        billItems.appendChild(row);
    });

    const subtotalRow = document.createElement('tr');
    subtotalRow.innerHTML = `
        <td class="pt-2 text-right font-bold pr-2 border-t border-blue-900 text-blue-900">Subtotal:</td>
        <td class="pt-2 text-right border-t border-blue-900 font-bold text-gray-800 pr-2">LKR ${Number(subtotal).toLocaleString()}</td>
    `;
    billItems.appendChild(subtotalRow);

    if (Number(discount) > 0) {
        const discountRow = document.createElement('tr');
        discountRow.innerHTML = `
            <td class="pt-1 text-right font-bold pr-2 text-red-600">Discount:</td>
            <td class="pt-1 text-right font-bold text-red-600 pr-2">- LKR ${Number(discount).toLocaleString()}</td>
        `;
        billItems.appendChild(discountRow);
    }

    billTotal.innerHTML = `<span class="text-blue-900">LKR ${Number(total).toLocaleString()}</span>`;

    // Set document title for PDF filename
    const originalTitle = document.title;
    document.title = `Nemin Motors Invoice #${displayId}`;

    // Trigger Print with small delay to ensure rendering
    document.body.classList.add('printing-bill');
    setTimeout(() => {
        window.print();
        // Restore title after print dialog closes/opens
        setTimeout(() => {
            document.body.classList.remove('printing-bill');
            document.title = originalTitle;
        }, 1000);
    }, 300);
}

// --- History ---

async function loadHistory() {
    try {
        const snap = await fs.collection('nm_sales').get();
        cachedSales = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort client-side to avoid index requirements
        cachedSales.sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('history-table-body');
        tbody.innerHTML = '';

        cachedSales.forEach(sale => {
            const date = new Date(sale.date);
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 border-b border-gray-100";
            tr.innerHTML = `
            <td class="px-6 py-4" onclick="event.stopPropagation()">
                <input type="checkbox" onchange="toggleHistoryRow()" value="${sale.id}" class="history-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500">
            </td>
            <td class="px-6 py-4 font-medium cursor-pointer" onclick="openSaleModal('${sale.id}')">#${getDisplayId(sale)}</td>
            <td class="px-6 py-4 text-sm cursor-pointer" onclick="openSaleModal('${sale.id}')">${date.toLocaleString()}</td>
            <td class="px-6 py-4 text-sm text-gray-500 cursor-pointer" onclick="openSaleModal('${sale.id}')">
                <div class="max-w-xs truncate font-medium text-slate-700">
                    ${sale.items.map(item => item.model).join(', ')}
                </div>
                <div class="text-xs text-slate-400 mt-0.5">${sale.items.length} ${sale.items.length === 1 ? 'item' : 'items'}</div>
            </td>
            <td class="px-6 py-4 text-right font-bold text-gray-900 cursor-pointer" onclick="openSaleModal('${sale.id}')">LKR ${Number(sale.total).toLocaleString()}</td>
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center items-center gap-2">
                    <button onclick="rePrintBill('${sale.id}'); event.stopPropagation();" class="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 transition-all flex items-center gap-1" title="Print Bill">
                        <i class="fa-solid fa-print"></i>
                        <span class="text-xs font-bold">Print</span>
                    </button>
                    <button onclick="deleteSale('${sale.id}'); event.stopPropagation();" class="text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 transition-all flex items-center gap-1" title="Delete Record">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
            tbody.appendChild(tr);
        });

        // Reset Bulk UI
        const master = document.getElementById('history-select-all');
        if (master) master.checked = false;
        const btn = document.getElementById('bulk-delete-btn');
        if (btn) btn.classList.add('hidden');
    } catch (error) {
        console.error("History Load Error:", error);
    }
}

// Consolidated rePrintBill function - handles both memory and async fetch
async function rePrintBill(id) {
    console.log("Reprinting Bill ID:", id);

    try {
        let sale = cachedSales.find(s => s.id === id);

        // If not in cache (e.g., direct link or after refresh), fetch from Firestore
        if (!sale) {
            console.log("Sale not in cache, fetching from Firestore...");
            const doc = await fs.collection('nm_sales').doc(id).get();
            if (doc.exists) {
                sale = { id: doc.id, ...doc.data() };
            } else {
                // Try local DB if firestore fails or for legacy
                if (typeof db !== 'undefined' && db.sales) {
                    sale = await db.sales.get(id);
                }
            }
        }

        if (sale) {
            const subtotal = sale.subtotal !== undefined ? sale.subtotal : sale.total;
            const discount = sale.discount || 0;

            // Trigger print directly without showing modal
            printBill(id, subtotal, discount, sale.total, sale.items || [], sale.invoiceNo);
        } else {
            alert("Sale record not found!");
        }
    } catch (error) {
        console.error("Reprint Error:", error);
        alert("Failed to reprint: " + error.message);
    }
}

async function openSaleModal(id, preFetchedData = null) {
    let sale, saleId;

    if (preFetchedData) {
        sale = preFetchedData;
        saleId = id;
    } else {
        const doc = await fs.collection('nm_sales').doc(id).get();
        if (!doc.exists) return;
        sale = doc.data();
        saleId = doc.id;
    }

    const modal = document.getElementById('sale-modal');
    const panel = document.getElementById('sale-modal-panel');

    // Header
    const displayId = getDisplayId({ id: saleId, invoiceNo: sale.invoiceNo });
    document.getElementById('modal-sale-id').innerText = `Sale #${displayId}`;
    document.getElementById('modal-sale-date').innerText = new Date(sale.date).toLocaleString();

    // Items
    const tbody = document.getElementById('modal-sale-items');
    tbody.innerHTML = '';

    sale.items.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="py-3">
                <div class="font-medium text-gray-800">${item.model}</div>
                <div class="text-xs text-gray-500">
                    ${item.serialNumber ? `<span class="text-blue-600 font-mono">SN: ${item.serialNumber}</span> • ` : ''}
                    ${item.processor || ''} ${item.ram ? '• ' + item.ram : ''}
                </div>
            </td>
            <td class="py-3 text-center text-gray-600">${item.cartQty}</td>
            <td class="py-3 text-right text-gray-600">${Number(item.price).toLocaleString()}</td>
            <td class="py-3 text-right font-medium text-gray-800">${Number(item.price * item.cartQty).toLocaleString()}</td>
        `;
        tbody.appendChild(row);
    });

    // Totals
    let subtotal = sale.subtotal || sale.total;
    let discount = sale.discount || 0;

    // Fallback logic
    if (sale.subtotal === undefined && sale.discount === undefined) {
        discount = 0;
        subtotal = sale.total;
    }

    document.getElementById('modal-sale-subtotal').innerText = `LKR ${Number(subtotal).toLocaleString()}`;
    document.getElementById('modal-sale-discount').innerText = `- LKR ${Number(discount).toLocaleString()}`;
    document.getElementById('modal-sale-total').innerText = `LKR ${Number(sale.total).toLocaleString()}`;

    // Discount Row Visibility
    const discountRow = document.getElementById('modal-discount-row');
    if (discount > 0) {
        discountRow.classList.remove('hidden');
        discountRow.classList.add('flex');
    } else {
        discountRow.classList.add('hidden');
        discountRow.classList.remove('flex');
    }

    // Print Button
    const printBtn = document.getElementById('modal-print-btn');
    printBtn.onclick = () => rePrintBill(saleId);

    // Show
    modal.classList.remove('hidden');
    setTimeout(() => {
        panel.classList.remove('opacity-0', 'scale-95');
        panel.classList.add('opacity-100', 'scale-100');
    }, 10);
}

function closeSaleModal() {
    const modal = document.getElementById('sale-modal');
    const panel = document.getElementById('sale-modal-panel');

    panel.classList.remove('opacity-100', 'scale-100');
    panel.classList.add('opacity-0', 'scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function toggleAllHistory() {
    const master = document.getElementById('history-select-all');
    const boxes = document.querySelectorAll('.history-checkbox');
    boxes.forEach(box => box.checked = master.checked);
    toggleHistoryRow();
}

function toggleHistoryRow() {
    const boxes = document.querySelectorAll('.history-checkbox:checked');
    const btn = document.getElementById('bulk-delete-btn');
    if (boxes.length > 0) {
        btn.classList.remove('hidden');
        btn.innerHTML = `<i class="fa-solid fa-trash"></i> Delete (${boxes.length})`;
    } else {
        btn.classList.add('hidden');
        const master = document.getElementById('history-select-all');
        if (master) master.checked = false;
    }
}

async function deleteSelectedSales() {
    const boxes = document.querySelectorAll('.history-checkbox:checked');
    if (boxes.length === 0) return;

    if (confirm(`Are you sure you want to delete ${boxes.length} records?`)) {
        const batch = fs.batch();
        boxes.forEach(box => {
            batch.delete(fs.collection('nm_sales').doc(box.value));
        });
        await batch.commit();
        loadHistory();
    }
}
// --- Agreement Management ---

async function loadAgreements() {
    try {
        const snap = await fs.collection('nm_agreements').get();
        const agreements = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        agreements.sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('agreement-table-body');
        const search = document.getElementById('agreement-search').value.toLowerCase();

        tbody.innerHTML = '';

        const filtered = agreements.filter(ag =>
            ag.customerName.toLowerCase().includes(search) ||
            ag.bikeModel.toLowerCase().includes(search) ||
            (ag.customerPhone && ag.customerPhone.includes(search))
        );

        filtered.forEach(ag => {
            const date = new Date(ag.date);
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 border-b border-gray-100";
            tr.innerHTML = `
                <td class="px-6 py-4 font-mono text-xs font-bold text-slate-500">#${ag.agreementNo ? String(ag.agreementNo).padStart(2, '0') : '-'}</td>
                <td class="px-6 py-4 text-sm">${date.toLocaleDateString()}</td>
                <td class="px-6 py-4 font-medium text-gray-900">${ag.customerName}</td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    <div class="font-medium text-slate-700">${ag.bikeModel}</div>
                    <div class="text-[10px] uppercase text-slate-400">${ag.bikePlate || 'No Plate'}</div>
                </td>
                <td class="px-6 py-4 text-right font-bold text-green-600">LKR ${Number(ag.advanceAmount).toLocaleString()}</td>
                <td class="px-6 py-4 text-right font-bold text-rose-600">LKR ${Number(ag.balanceAmount).toLocaleString()}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex justify-center items-center gap-2">
                        <button onclick="printAgreement('${ag.id}')" class="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 transition-all flex items-center gap-1">
                            <i class="fa-solid fa-print"></i>
                            <span class="text-xs font-bold">Print</span>
                        </button>
                        <button onclick="deleteAgreement('${ag.id}')" class="text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 transition-all">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400 italic">No agreements found.</td></tr>';
        }
    } catch (error) {
        console.error("Load agreements error:", error);
    }
}

async function openAgreementModal() {
    const modal = document.getElementById('agreement-modal');
    const panel = document.getElementById('agreement-modal-panel');
    const bikeSelect = document.getElementById('agreement-bike-select');

    // Clear Form
    document.getElementById('agreement-form').reset();
    document.getElementById('agreement-id').value = '';

    // Load Bikes into select
    const productsSnap = await fs.collection('nm_products').get();
    const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    bikeSelect.innerHTML = '<option value="">-- Choose Bike --</option>';
    products.filter(p => p.quantity > 0).forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.dataset.model = p.model;
        option.dataset.plate = p.ports || '';
        option.dataset.price = p.price;
        option.dataset.chassis = p.battery_life || '';
        option.dataset.engine = p.serialNumber || '';
        option.innerText = `${p.model} (${p.ports || 'No Plate'})`;
        bikeSelect.appendChild(option);
    });

    modal.classList.remove('hidden');
    setTimeout(() => {
        panel.classList.remove('translate-x-full');
        initSignPads(); // Initialize signature pads after panel is visible
    }, 10);
}

function closeAgreementModal() {
    const modal = document.getElementById('agreement-modal');
    const panel = document.getElementById('agreement-modal-panel');

    panel.classList.add('translate-x-full');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function autoFillBikeDetails() {
    const select = document.getElementById('agreement-bike-select');
    const selected = select.options[select.selectedIndex];

    if (selected.value) {
        document.getElementById('agreement-bike-model').value = selected.dataset.model;
        document.getElementById('agreement-bike-plate').value = selected.dataset.plate;
        document.getElementById('agreement-total-price').value = selected.dataset.price;
        calculateAgreementBalance();
    } else {
        document.getElementById('agreement-bike-model').value = '';
        document.getElementById('agreement-bike-plate').value = '';
        document.getElementById('agreement-total-price').value = '';
        document.getElementById('agreement-balance').value = '';
    }
}

function calculateAgreementBalance() {
    const total = parseFloat(document.getElementById('agreement-total-price').value) || 0;
    const advance = parseFloat(document.getElementById('agreement-advance').value) || 0;
    const balance = total - advance;
    document.getElementById('agreement-balance').value = balance;
}

async function saveAgreement() {
    const form = document.getElementById('agreement-form');
    const select = document.getElementById('agreement-bike-select');
    const selected = select.options[select.selectedIndex];

    if (!document.getElementById('agreement-customer-name').value || !selected.value) {
        alert("Please fill required fields (Customer Name and Bike selection)");
        return;
    }

    const counterRef = fs.collection('nm_settings').doc('counters');
    const agRef = fs.collection('nm_agreements').doc();
    let finalAgNo = 1;

    try {
        await fs.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            finalAgNo = (counterDoc.exists ? (counterDoc.data().agreementCount || 0) : 0) + 1;

            const agreementData = {
                agreementNo: finalAgNo,
                date: new Date().toISOString(),
                bikeId: selected.value,
                bikeModel: selected.dataset.model,
                bikePlate: selected.dataset.plate,
                bikeChassis: selected.dataset.chassis,
                bikeEngine: selected.dataset.engine,
                customerName: document.getElementById('agreement-customer-name').value,
                customerNIC: document.getElementById('agreement-customer-nic').value,
                customerPhone: document.getElementById('agreement-customer-phone').value,
                customerAddress: document.getElementById('agreement-customer-address').value,
                totalPrice: parseFloat(document.getElementById('agreement-total-price').value),
                advanceAmount: parseFloat(document.getElementById('agreement-advance').value),
                balanceAmount: parseFloat(document.getElementById('agreement-balance').value),
                dueDate: document.getElementById('agreement-due-date').value,
                terms: document.getElementById('agreement-terms').value,
                sellerSignature: document.getElementById('seller-sign-pad').toDataURL(),
                buyerSignature: document.getElementById('buyer-sign-pad').toDataURL(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            transaction.set(counterRef, { agreementCount: finalAgNo }, { merge: true });
            transaction.set(agRef, agreementData);
        });

        alert("Agreement saved successfully!");
        closeAgreementModal();
        loadAgreements();

        // Fetch the data back or just use what we have
        const finalData = (await agRef.get()).data();
        printAgreement(agRef.id, finalData);

    } catch (error) {
        console.error("Save agreement error:", error);
        alert("Failed to save agreement: " + error.message);
    }
}

async function printAgreement(id, preData = null) {
    let data = preData;
    if (!data) {
        const doc = await fs.collection('nm_agreements').doc(id).get();
        if (!doc.exists) return;
        data = doc.data();
    }

    // Fill print template
    const displayId = data.agreementNo ? String(data.agreementNo).padStart(2, '0') : id.substring(0, 6).toUpperCase();
    document.getElementById('print-ag-id').innerText = `Ref: #${displayId}`;
    document.getElementById('print-ag-date').innerText = `Date: ${new Date(data.date).toLocaleDateString()}`;

    document.getElementById('print-ag-cust-name').innerText = data.customerName;
    document.getElementById('print-ag-cust-nic').innerText = data.customerNIC || '-';
    document.getElementById('print-ag-cust-phone').innerText = data.customerPhone;
    document.getElementById('print-ag-cust-address').innerText = data.customerAddress || '-';

    document.getElementById('print-ag-bike-model').innerText = data.bikeModel;
    document.getElementById('print-ag-bike-plate').innerText = data.bikePlate || '-';
    document.getElementById('print-ag-bike-chassis').innerText = data.bikeChassis || '-';
    document.getElementById('print-ag-bike-engine').innerText = data.bikeEngine || '-';

    document.getElementById('print-ag-total').innerText = `LKR ${Number(data.totalPrice).toLocaleString()}`;
    document.getElementById('print-ag-advance').innerText = `LKR ${Number(data.advanceAmount).toLocaleString()}`;
    document.getElementById('print-ag-balance').innerText = `LKR ${Number(data.balanceAmount).toLocaleString()}`;
    document.getElementById('print-ag-due-date').innerText = data.dueDate ? new Date(data.dueDate).toLocaleDateString() : 'N/A';

    document.getElementById('print-ag-terms').innerText = data.terms;

    // Show Signatures if they exist
    const sellerSignImg = document.getElementById('print-ag-seller-sign');
    const buyerSignImg = document.getElementById('print-ag-buyer-sign');

    if (data.sellerSignature && data.sellerSignature.length > 1000) {
        sellerSignImg.src = data.sellerSignature;
        sellerSignImg.classList.remove('hidden');
    } else {
        sellerSignImg.classList.add('hidden');
    }

    if (data.buyerSignature && data.buyerSignature.length > 1000) {
        buyerSignImg.src = data.buyerSignature;
        buyerSignImg.classList.remove('hidden');
    } else {
        buyerSignImg.classList.add('hidden');
    }

    // Set document title for PDF
    const originalTitle = document.title;
    document.title = `Agreement_${data.customerName.replace(/\s+/g, '_')}`;

    // Add printing class to body to control visibility via CSS
    document.body.classList.add('printing-agreement');

    setTimeout(() => {
        window.print();
        document.body.classList.remove('printing-agreement');
        document.title = originalTitle;
    }, 500);
}

async function deleteAgreement(id) {
    if (confirm("Are you sure you want to delete this agreement record?")) {
        await fs.collection('nm_agreements').doc(id).delete();
        loadAgreements();
    }
}

// --- Listeners ---

document.getElementById('inventory-search').addEventListener('input', loadInventory);
document.getElementById('sales-search').addEventListener('input', loadSalesGrid);

// Toggle Sidebar for mobile
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('hidden');
}

document.getElementById('toggleSidebar').addEventListener('click', toggleMobileSidebar);

// Clock
setInterval(() => {
    const now = new Date();
    document.getElementById('current-time').innerText = now.toLocaleTimeString();
    document.getElementById('current-date').innerText = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}, 1000);

// rePrintBill handled above as consolidated async function

async function deleteSale(id) {
    if (confirm('Are you sure you want to delete this sale record? This action cannot be undone.')) {
        await fs.collection('nm_sales').doc(id).delete();
        loadHistory();
    }
}

async function migrateToFirebase() {
    if (!confirm("This will upload all your local inventory and sales to the cloud. Continue?")) return;

    try {
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = "Migrating...";
        btn.disabled = true;

        // 1. Migrate Products
        const products = await localDb.products.toArray();
        const productBatch = fs.batch();
        for (const p of products) {
            const { id, ...data } = p;
            const ref = fs.collection('nm_products').doc();
            productBatch.set(ref, { ...data, migratredAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        await productBatch.commit();

        // 2. Migrate Sales
        const sales = await localDb.sales.toArray();
        const salesBatch = fs.batch();
        for (const s of sales) {
            const { id, ...data } = s;
            const ref = fs.collection('nm_sales').doc();
            salesBatch.set(ref, { ...data, migratredAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        await salesBatch.commit();

        alert("Migration successful! Your data is now in the cloud.");
        btn.innerText = originalText;
        btn.disabled = false;
        loadInventory();
        loadDashboard();
    } catch (error) {
        console.error("Migration failed:", error);
        alert("Migration failed: " + error.message);
    }
}

// --- Signature Pad Logic ---
let signPads = {};

function initSignPads() {
    const pads = ['seller', 'buyer'];
    pads.forEach(role => {
        const canvas = document.getElementById(`${role}-sign-pad`);
        if (!canvas) return;

        // Set internal resolution to match displayed size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#1e293b'; // Tailwind slate-800
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        let drawing = false;

        // Drawing events
        const start = (e) => {
            drawing = true;
            ctx.beginPath();
            const { x, y } = getPos(e, canvas);
            ctx.moveTo(x, y);
        };
        const move = (e) => {
            if (!drawing) return;
            const { x, y } = getPos(e, canvas);
            ctx.lineTo(x, y);
            ctx.stroke();
        };
        const end = () => { drawing = false; };

        canvas.onmousedown = start;
        canvas.onmousemove = move;
        window.onmouseup = end;

        canvas.ontouchstart = (e) => { e.preventDefault(); start(e.touches[0]); };
        canvas.ontouchmove = (e) => { e.preventDefault(); move(e.touches[0]); };
        canvas.ontouchend = end;

        signPads[role] = { canvas, ctx };
    });
}

function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function clearSign(role) {
    const pad = signPads[role];
    if (pad) {
        pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    }
}

// Init
checkLastBill();
switchTab('dashboard');
