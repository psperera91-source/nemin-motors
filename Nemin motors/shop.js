// --- Firebase Configuration ---
// Must match app.js config exactly to access the same DB
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
var firebaseAuth = firebase.auth();
const storage = firebase.storage();

// State
let allProducts = [];
let activeFilter = 'all';
let cart = JSON.parse(localStorage.getItem('pos-cart')) || [];
let customer = JSON.parse(localStorage.getItem('pos-customer')) || null;
let currentModalProductId = null;
let currentLightboxIndex = 0;
let currentModalImages = [];
let deferredPrompt; // PWA Install Prompt state

// DOM Elements
const container = document.getElementById('shop-container');
const searchInput = document.getElementById('shop-search');
const noResults = document.getElementById('no-results');

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadProducts();
});

// Event Listeners
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        renderShop(e.target.value);
    });
}

// PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show install button if it exists
    const installBtn = document.getElementById('install-app-btn');
    const mobileInstallBtn = document.getElementById('mobile-install-btn');
    if (installBtn) installBtn.classList.remove('hidden');
    if (mobileInstallBtn) mobileInstallBtn.classList.remove('hidden');
});

async function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const installBtn = document.getElementById('install-app-btn');
        const mobileInstallBtn = document.getElementById('mobile-install-btn');
        if (installBtn) installBtn.classList.add('hidden');
        if (mobileInstallBtn) mobileInstallBtn.classList.add('hidden');
    }
    deferredPrompt = null;
}

// --- Theme Management ---

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcons(isDark);
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const shouldBeDark = savedTheme === 'dark' || (!savedTheme && systemPrefersDark);

    if (shouldBeDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    updateThemeIcons(shouldBeDark);
}

function updateThemeIcons(isDark) {
    const darkIcon = document.getElementById('theme-toggle-dark-icon');
    const lightIcon = document.getElementById('theme-toggle-light-icon');

    if (darkIcon && lightIcon) {
        if (isDark) {
            darkIcon.classList.add('hidden');
            lightIcon.classList.remove('hidden');
        } else {
            darkIcon.classList.remove('hidden');
            lightIcon.classList.add('hidden');
        }
    }
}

async function loadProducts() {
    // 1. Instant Load from Cache
    const cachedData = localStorage.getItem('nm_products_cache');
    if (cachedData) {
        try {
            allProducts = JSON.parse(cachedData);
            renderShop();
        } catch (e) { console.error("Cache error", e); }
    }

    try {
        // 2. Background Fetch from Firebase
        const snapshot = await fs.collection('nm_products').get();
        allProducts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Sort: High Stock -> Low Stock, then Newest
        allProducts.sort((a, b) => {
            if (b.quantity !== a.quantity) return b.quantity - a.quantity;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        // 3. Update Cache & UI
        localStorage.setItem('nm_products_cache', JSON.stringify(allProducts));
        renderShop();

        console.log("Products synced with Cloud");
    } catch (error) {
        console.error("Error loading products:", error);
        if (allProducts.length === 0) { // Only show error if we have NO data
            container.innerHTML = `
                <div class="col-span-full text-center py-10">
                    <i class="fa-solid fa-wifi text-4xl text-slate-300 mb-4"></i>
                    <p class="text-slate-500">Could not connect to the store. Please check your internet.</p>
                    <button onclick="loadProducts()" class="mt-4 text-brand-600 font-medium hover:underline">Try Again</button>
                </div>
            `;
        }
    }
}

function filterShop(tag) {
    activeFilter = tag;

    // Update UI buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const isSelected = btn.getAttribute('onclick').includes(`'${tag}'`);

        if (isSelected) {
            btn.classList.add('active', 'bg-slate-900', 'dark:bg-slate-100', 'text-white', 'dark:text-slate-900');
            btn.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-400', 'border-slate-100', 'dark:border-slate-700');
            // If it's a category button, it might have an icon
            const icon = btn.querySelector('i');
            if (icon) icon.classList.add('text-brand-400', 'dark:text-brand-600');
        } else {
            btn.classList.remove('active', 'bg-slate-900', 'dark:bg-slate-100', 'text-white', 'dark:text-slate-900');
            btn.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-400', 'border-slate-100', 'dark:border-slate-700');
            const icon = btn.querySelector('i');
            if (icon) icon.classList.remove('text-brand-400', 'dark:text-brand-600');
        }
    });

    // Reset search when filtering by tag (optional preference, but good for UX)
    renderShop(searchInput.value);
}

function renderShop(searchTerm = "") {
    let filtered = allProducts.filter(p => p.quantity > 0);
    const term = searchTerm.toLowerCase().trim();

    // 1. Text Search
    if (term) {
        filtered = filtered.filter(p =>
            (p.model || "").toLowerCase().includes(term) ||
            (p.processor || "").toLowerCase().includes(term) ||
            (p.ram || "").toLowerCase().includes(term) ||
            (p.storage || "").toLowerCase().includes(term) ||
            (p.description || "").toLowerCase().includes(term) ||
            (p.serialNumber || "").toLowerCase().includes(term)
        );
    }

    // 2. Tag Filter
    if (activeFilter !== 'all') {
        const tag = activeFilter.toLowerCase();
        if (tag === 'gaming') {
            // Heuristic for gaming: dedicated graphics or "gaming" keyword
            filtered = filtered.filter(p =>
                (p.graphics && !p.graphics.toLowerCase().includes('intel') && !p.graphics.toLowerCase().includes('shared')) ||
                (p.model || "").toLowerCase().includes('game') ||
                (p.model || "").toLowerCase().includes('nvidia') ||
                (p.model || "").toLowerCase().includes('rtx') ||
                (p.model || "").toLowerCase().includes('gtx')
            );
        } else if (tag === 'bike' || tag === 'spare part' || tag === 'accessory') {
            // New Category Filter
            filtered = filtered.filter(p => (p.category || 'bike').toLowerCase() === tag);
        } else {
            // For brands or other tags
            filtered = filtered.filter(p =>
                (p.processor || "").toLowerCase().includes(tag) ||
                (p.model || "").toLowerCase().includes(tag) ||
                (p.category || "").toLowerCase().includes(tag)
            );
        }
    }

    // Render
    container.innerHTML = '';

    if (filtered.length === 0) {
        noResults.classList.remove('hidden');
    } else {
        noResults.classList.add('hidden');
        filtered.forEach(p => {
            const card = createProductCard(p);
            container.innerHTML += card;
        });
    }
}

function createProductCard(p) {
    // Generate WhatsApp Link
    const message = `Hi, I am interested in the ${p.model} listed for LKR ${Number(p.price).toLocaleString()}. is this still available?`;
    const waLink = `https://wa.me/94753228884?text=${encodeURIComponent(message)}`;

    // Specs format
    const specs = [
        { icon: 'fa-motorcycle', text: p.processor }, // Engine
        { icon: 'fa-gauge', text: p.ram }, // Mileage
        { icon: 'fa-gas-pump', text: p.storage } // Fuel
    ].filter(s => s.text).slice(0, 3);

    // Dynamic Image Placeholder
    const isBike = (p.category || '').toLowerCase() === 'bike' || (p.category || '').toLowerCase() === 'all';
    const mainIcon = isBike ? 'fa-motorcycle' : 'fa-gears';

    let imageContent = `
        <div class="w-full h-32 sm:h-48 bg-gray-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-slate-50 dark:group-hover:bg-slate-700 transition-colors">
            <i class="fa-solid ${mainIcon} text-4xl sm:text-6xl text-slate-200 dark:text-slate-700 group-hover:text-brand-200 dark:group-hover:text-brand-800 transition-colors"></i>
        </div>
    `;

    if (p.imageUrl) {
        imageContent = `
            <div class="w-full h-32 sm:h-48 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden p-2">
                <img src="${p.imageUrl}" alt="${p.model}" loading="lazy" class="w-full h-full object-contain transform group-hover:scale-110 transition-transform duration-500">
            </div>
        `;
    }

    const imagePlaceholder = `
        <div class="relative overflow-hidden group-hover:scale-105 transition-transform duration-500">
            ${imageContent}
            ${p.conditions ? `<span class="absolute top-3 left-3 bg-white/90 dark:bg-slate-800/90 backdrop-blur text-[10px] sm:text-xs font-bold px-2 py-1 rounded shadow-sm uppercase tracking-wider text-slate-700 dark:text-slate-200 z-10">${p.conditions}</span>` : ''}
        </div>
    `;

    return `
        <div onclick="openProductModal('${p.id}')" class="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:border-brand-100 dark:hover:border-brand-900 transition-all duration-300 overflow-hidden flex flex-col cursor-pointer active:scale-[0.98]">
            <!-- Image Area -->
            ${imagePlaceholder}

            <!-- Content -->
            <div class="p-3 sm:p-5 flex flex-col flex-grow">
                <h3 class="font-bold text-slate-800 dark:text-white text-sm sm:text-lg mb-2 leading-tight group-hover:text-brand-600 transition-colors">${p.model}</h3>
                
                <!-- Spec Badges -->
                <div class="flex flex-wrap gap-2 mb-4">
                    ${(p.category || '').toLowerCase() === 'bike' ? `
                        <span class="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800 text-[10px] sm:text-xs font-bold text-rose-600 dark:text-rose-400">
                            BIKE
                        </span>
                    ` : ''}
                    ${specs.map(s => `
                        <span class="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400">
                            <i class="fa-solid ${s.icon} text-slate-400"></i> ${s.text}
                        </span>
                    `).join('')}
                    ${p.display ? `
                        <span class="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400">
                            <i class="fa-solid fa-expand text-slate-400"></i> ${p.display}
                        </span>
                    ` : ''}
                </div>

                <div class="mt-auto pt-4 border-t border-slate-50 dark:border-slate-800 flex items-center justify-between gap-4">
                    <div>
                        <p class="text-[9px] sm:text-[10px] text-slate-400 font-medium uppercase tracking-wider">Cash Price</p>
                        <p class="text-base sm:text-xl font-bold text-slate-900 dark:text-white">LKR ${Number(p.price).toLocaleString()}</p>
                    </div>
                    <div class="bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-lg sm:rounded-xl w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center transition-transform group-hover:scale-110">
                        <i class="fa-solid fa-arrow-right text-xs sm:text-base"></i>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function openProductModal(id) {
    currentModalProductId = id;
    const slider = document.getElementById('modal-slider');
    const dotsContainer = document.getElementById('slider-dots');
    const prevBtn = document.getElementById('slider-prev');
    const nextBtn = document.getElementById('slider-next');

    if (slider) slider.scrollLeft = 0; // Immediate reset
    const p = allProducts.find(product => product.id === id);
    if (!p) return;

    // Populate Data
    document.getElementById('modal-title').innerText = p.model;
    document.getElementById('modal-price').innerText = `LKR ${Number(p.price).toLocaleString()}`;
    document.getElementById('modal-condition').innerText = p.conditions || 'Standard';

    // Specs
    // Bike Specific Labels matching POS
    document.getElementById('modal-processor').innerText = p.processor || '-'; // Engine
    document.getElementById('modal-ram').innerText = p.ram || '-'; // Mileage
    document.getElementById('modal-storage').innerText = p.storage || '-'; // Fuel
    document.getElementById('modal-graphics').innerText = p.graphics || '-'; // Transmission
    document.getElementById('modal-display').innerText = p.display || '-'; // Color
    document.getElementById('modal-os').innerText = p.os || '-'; // Year
    document.getElementById('modal-ports').innerText = p.ports || '-'; // Plate
    document.getElementById('modal-battery').innerText = p.battery_life || '-'; // Chassis
    document.getElementById('modal-engine').innerText = p.serialNumber || '-'; // Engine #
    document.getElementById('modal-included').innerText = p.included_items || '-'; // Features

    // Images Slider
    slider.innerHTML = '';
    dotsContainer.innerHTML = '';

    const imgs = p.imageUrls && p.imageUrls.length > 0 ? p.imageUrls : (p.imageUrl ? [p.imageUrl] : []);
    currentModalImages = imgs;

    // Find the index of the primary image to show it first
    let startIndex = 0;
    if (p.imageUrl) {
        startIndex = imgs.indexOf(p.imageUrl);
        if (startIndex === -1) startIndex = 0;
    }

    if (imgs.length > 0) {
        imgs.forEach((url, index) => {
            // Slide
            const slide = document.createElement('div');
            slide.className = "flex-none w-full h-full snap-center flex items-center justify-center p-2 cursor-zoom-in";
            slide.innerHTML = `<img src="${url}" class="w-full h-full object-contain">`;
            slide.onclick = () => openLightbox(index);
            slider.appendChild(slide);

            // Dot
            if (imgs.length > 1) {
                const dot = document.createElement('button');
                dot.className = `w-2 h-2 rounded-full transition-all ${index === startIndex ? 'bg-brand-600 w-4' : 'bg-slate-300'}`;
                dot.onclick = () => {
                    slider.scrollTo({ left: slider.clientWidth * index, behavior: 'smooth' });
                };
                dotsContainer.appendChild(dot);
            }
        });

        // Initial scroll position to the correct starting image
        setTimeout(() => {
            const slideWidth = slider.clientWidth;
            if (slideWidth > 0) {
                slider.scrollTo({ left: slideWidth * startIndex, behavior: 'auto' });
            }
        }, 500);

        // Toggle Buttons
        if (imgs.length > 1) {
            prevBtn.classList.remove('hidden');
            nextBtn.classList.remove('hidden');
        } else {
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        }
    } else {
        slider.innerHTML = `
            <div class="min-w-full h-full flex items-center justify-center text-slate-300">
                <i class="fa-solid fa-motorcycle text-6xl"></i>
            </div>
        `;
        prevBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
    }

    // Scroll listener for dots
    slider.onscroll = () => {
        const index = Math.round(slider.scrollLeft / slider.offsetWidth);
        Array.from(dotsContainer.children).forEach((dot, i) => {
            if (i === index) {
                dot.classList.add('bg-brand-600', 'w-4');
                dot.classList.remove('bg-slate-300');
            } else {
                dot.classList.remove('bg-brand-600', 'w-4');
                dot.classList.add('bg-slate-300');
            }
        });
    };

    // WhatsApp Link
    const message = `Hi, I am interested in the ${p.model} listed for LKR ${Number(p.price).toLocaleString()}. Is this still available?`;
    document.getElementById('modal-wa-link').href = `https://wa.me/94753228884?text=${encodeURIComponent(message)}`;

    // Show Modal
    const modal = document.getElementById('product-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.firstElementChild.classList.remove('opacity-0');
        modal.querySelector('.transform').classList.remove('translate-x-full');
    }, 10);
}

function closeProductModal() {
    const modal = document.getElementById('product-modal');
    modal.firstElementChild.classList.add('opacity-0');
    modal.querySelector('.transform').classList.add('translate-x-full');

    setTimeout(() => {
        modal.classList.add('hidden');
        document.getElementById('modal-slider').scrollLeft = 0; // Reset slider
    }, 300);
}

function moveSlider(dir) {
    const slider = document.getElementById('modal-slider');
    slider.scrollBy({ left: slider.clientWidth * dir, behavior: 'smooth' });
}

// --- Lightbox Logic ---

function openLightbox(index) {
    currentLightboxIndex = index;
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');

    img.src = currentModalImages[currentLightboxIndex];
    img.classList.remove('zoomed');
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

function toggleZoom() {
    const img = document.getElementById('lightbox-img');
    img.classList.toggle('zoomed');
}

function moveLightbox(dir) {
    currentLightboxIndex = (currentLightboxIndex + dir + currentModalImages.length) % currentModalImages.length;
    const img = document.getElementById('lightbox-img');
    img.src = currentModalImages[currentLightboxIndex];
    img.classList.remove('zoomed');
}

// --- Cart Logic ---

function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    const panel = sidebar.querySelector('.transform');

    if (sidebar.classList.contains('hidden')) {
        sidebar.classList.remove('hidden');
        renderCartItems();
        setTimeout(() => {
            panel.classList.remove('translate-x-full');
        }, 10);
    } else {
        panel.classList.add('translate-x-full');
        setTimeout(() => {
            sidebar.classList.add('hidden');
        }, 300);
    }
}

function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const existingItem = cart.find(item => item.id === productId);
    if (existingItem) {
        existingItem.qty += 1;
    } else {
        cart.push({
            id: product.id,
            model: product.model,
            price: product.price,
            imageUrl: product.imageUrl,
            qty: 1
        });
    }

    saveCart();
    updateCartBadge();

    // Feedback
    const btn = document.getElementById('add-to-cart-btn');
    if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Added';
        setTimeout(() => {
            btn.innerHTML = original;
        }, 1000);
    }

    // Auto open cart
    closeProductModal();
    setTimeout(() => {
        if (document.getElementById('cart-sidebar').classList.contains('hidden')) {
            toggleCart();
        }
    }, 300);
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    renderCartItems();
    updateCartBadge();
}

function updateCartQty(productId, change) {
    const item = cart.find(i => i.id === productId);
    if (item) {
        item.qty += change;
        if (item.qty <= 0) {
            removeFromCart(productId);
        } else {
            saveCart();
            renderCartItems();
        }
    }
}

function saveCart() {
    localStorage.setItem('pos-cart', JSON.stringify(cart));
}

function updateCartBadge() {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const badges = [document.getElementById('cart-badge'), document.getElementById('mobile-cart-badge')];

    badges.forEach(badge => {
        if (badge) {
            badge.innerText = count;
            if (count > 0) {
                badge.classList.remove('scale-0');
            } else {
                badge.classList.add('scale-0');
            }
        }
    });
}

function renderCartItems() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-64 text-slate-400">
                <i class="fa-solid fa-basket-shopping text-5xl mb-4 opacity-50"></i>
                <p>Your cart is empty</p>
                <button onclick="toggleCart()" class="mt-4 text-brand-600 font-medium hover:underline">Start Shopping</button>
            </div>
        `;
        totalEl.innerText = 'LKR 0.00';
        return;
    }

    let total = 0;
    container.innerHTML = cart.map(item => {
        total += item.price * item.qty;
        return `
            <div class="flex gap-4 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div class="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                    ${item.imageUrl
                ? `<img src="${item.imageUrl}" class="w-full h-full object-cover">`
                : `<i class="fa-solid fa-motorcycle text-slate-400"></i>`
            }
                </div>
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-slate-800 text-sm truncate">${item.model}</h4>
                    <p class="text-brand-600 font-bold text-sm">LKR ${Number(item.price).toLocaleString()}</p>
                    
                    <div class="flex items-center gap-3 mt-2">
                        <button onclick="updateCartQty('${item.id}', -1)" class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 text-xs">
                            <i class="fa-solid fa-minus"></i>
                        </button>
                        <span class="text-sm font-medium w-4 text-center">${item.qty}</span>
                        <button onclick="updateCartQty('${item.id}', 1)" class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 text-xs">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                        <button onclick="removeFromCart('${item.id}')" class="ml-auto text-xs text-red-500 hover:text-red-600">
                            Remove
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    totalEl.innerText = `LKR ${Number(total).toLocaleString()}`;
}

function checkoutWhatsApp() {
    if (cart.length === 0) return;

    let message = "Hi Nemin Motors, I would like to order:\n\n";
    let total = 0;

    cart.forEach(item => {
        const itemTotal = item.price * item.qty;
        total += itemTotal;
        message += `• ${item.model} (x${item.qty}) - LKR ${Number(itemTotal).toLocaleString()}\n`;
    });

    message += `\n*Total Estimate: LKR ${Number(total).toLocaleString()}*`;

    if (customer && customer.name) {
        message += `\n\nCustomer: ${customer.name}`;
    }

    message += "\n\nPlease confirm availability.";

    window.open(`https://wa.me/94753228884?text=${encodeURIComponent(message)}`, '_blank');
}

// --- Auth Logic (Firebase) ---

let currentUserData = null;

// Auth State Observer
firebaseAuth.onAuthStateChanged(async (user) => {
    if (user) {
        console.log("Auth: Logged In", user.uid);
        customer = {
            uid: user.uid,
            email: user.email,
            name: user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL
        };

        // Populate Profile Fields
        document.getElementById('profile-display-name').innerText = customer.name;
        document.getElementById('profile-display-email').innerText = customer.email;
        const [fName, ...lNames] = customer.name.split(' ');
        document.getElementById('profile-firstName').value = fName || '';
        document.getElementById('profile-lastName').value = lNames.join(' ') || '';

        // Handle Profile Image Preview
        const preview = document.getElementById('profile-img-preview');
        const placeholder = document.getElementById('profile-placeholder');
        if (user.photoURL) {
            preview.src = user.photoURL;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            preview.classList.add('hidden');
            placeholder.classList.remove('hidden');
        }

        updateAuthUI(true);
        // Only close if it's NOT the profile view (we want to keep profile open if they just saved)
        const modal = document.getElementById('auth-modal');
        const isProfileView = !document.getElementById('view-profile').classList.contains('hidden');
        if (modal && !modal.classList.contains('hidden') && !isProfileView) closeAuthModal();

    } else {
        console.log("Auth: Logged Out");
        customer = null;
        updateAuthUI(false);
        closeAuthModal(); // Close modal if open on logout
    }
});

function updateAuthUI(isLoggedIn) {
    const desktopBtn = document.getElementById('nav-login-btn');
    const mobileUser = document.getElementById('nav-user-btn');

    if (isLoggedIn && customer) {
        const userContent = customer.photoURL
            ? `<img src="${customer.photoURL}" class="w-6 h-6 rounded-full object-cover">`
            : `<i class="fa-solid fa-user-check text-green-500 mr-1.5"></i>`;

        if (desktopBtn) {
            desktopBtn.innerHTML = `${userContent} <span class="ml-1.5">${customer.name}</span>`;
            desktopBtn.onclick = openProfileModal;
            desktopBtn.classList.add('text-slate-900', 'font-bold');
        }
        if (mobileUser) {
            mobileUser.innerHTML = customer.photoURL
                ? `<img src="${customer.photoURL}" class="w-8 h-8 rounded-full border-2 border-green-500 object-cover">`
                : `<i class="fa-solid fa-user-check text-green-500 text-xl"></i>`;
            mobileUser.onclick = openProfileModal;
        }
    } else {
        if (desktopBtn) {
            desktopBtn.innerText = 'Login';
            desktopBtn.onclick = openLoginModal;
            desktopBtn.classList.remove('text-slate-900', 'font-bold');
        }
        if (mobileUser) {
            mobileUser.innerHTML = `<i class="fa-solid fa-user text-xl"></i>`;
            mobileUser.onclick = openLoginModal;
        }
    }
}

function confirmLogout() {
    if (confirm("Log out?")) firebaseAuth.signOut();
}

// Modal Functions
function openLoginModal() {
    switchAuthView('login');
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        const panel = document.getElementById('auth-panel');
        if (panel) panel.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    const panel = document.getElementById('auth-panel');
    if (panel) panel.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function switchAuthView(viewName) {
    ['login', 'signup', 'forgot', 'profile'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) {
            el.classList.add('hidden');
            el.style.opacity = '0';
        }
    });

    const target = document.getElementById(`view-${viewName}`);
    if (target) {
        target.classList.remove('hidden');
        // Clear errors
        ['login-error', 'signup-error', 'forgot-message'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        setTimeout(() => target.style.opacity = '1', 50);
    }
}

// Handlers
async function handleAuthLogin(e) {
    e.preventDefault();
    const form = e.target;
    // Use elements for safer access across browsers
    const email = form.elements['email'].value;
    const password = form.elements['password'].value;

    const btn = form.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('login-error');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    if (errorEl) errorEl.classList.add('hidden');

    try {
        await firebaseAuth.signInWithEmailAndPassword(email, password);
        // Success handled by onAuthStateChanged
    } catch (error) {
        console.error("Full Login error object:", error);
        const errorMsg = error.code ? translateAuthError(error.code) : (error.message || "An unexpected error occurred.");

        if (errorEl) {
            errorEl.innerText = errorMsg;
            errorEl.classList.remove('hidden');
        } else {
            alert(errorMsg);
        }
        btn.disabled = false;
        btn.innerHTML = 'Log In';
    }
}

async function handleAuthSignup(e) {
    e.preventDefault();
    const form = e.target;
    // Use elements for safer access across browsers
    const email = form.elements['email'].value;
    const password = form.elements['password'].value;
    const firstName = form.elements['firstName'].value;
    const lastName = form.elements['lastName'].value;

    const btn = form.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('signup-error');

    if (password.length < 6) {
        alert("Password must be at least 6 characters");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

    try {
        const cred = await firebaseAuth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: `${firstName} ${lastName}`.trim() });

        try {
            await fs.collection('customers').doc(cred.user.uid).set({
                firstName,
                lastName,
                email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (fsErr) {
            console.error("Firestore Error (ignored):", fsErr);
        }

        alert("Account created successfully! You are now logged in.");
        closeAuthModal();
    } catch (error) {
        console.error("Full Signup error object:", error);
        const errorMsg = error.code ? translateAuthError(error.code) : (error.message || "An unexpected error occurred.");

        if (errorEl) {
            errorEl.innerText = errorMsg;
            errorEl.classList.remove('hidden');
        } else {
            alert(errorMsg);
        }
        btn.disabled = false;
        btn.innerHTML = 'Create Account';
    }
}

async function handleAuthForgot(e) {
    e.preventDefault();
    const form = e.target;
    const email = form.email.value;
    const msgEl = document.getElementById('forgot-message');
    const btn = form.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

    try {
        await firebaseAuth.sendPasswordResetEmail(email);
        if (msgEl) {
            msgEl.innerHTML = `
                <div class="bg-green-50 text-green-700 p-3 rounded-lg border border-green-100 mt-2">
                    <p class="font-bold">Reset link sent!</p>
                    <p class="text-[10px] mt-1">Please check <b>${email}</b>. If you don't see it, check your <b>Spam/Junk</b> folder.</p>
                </div>
            `;
            msgEl.classList.remove('hidden');
        } else {
            alert(`Reset link sent to ${email}. Please check your inbox and Spam folder.`);
        }
        form.reset();
    } catch (error) {
        console.error("Forgot password error:", error);
        const errorMsg = translateAuthError(error.code) || error.message;
        if (msgEl) {
            msgEl.innerHTML = `
                <div class="bg-red-50 text-red-600 p-3 rounded-lg border border-red-100 mt-2">
                    <p class="font-bold">Error</p>
                    <p class="text-[10px] mt-1">${errorMsg}</p>
                </div>
            `;
            msgEl.classList.remove('hidden');
        } else {
            alert(errorMsg);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Send Reset Link';
    }
}

function translateAuthError(code) {
    if (!code) return "An unknown error occurred.";
    if (code === 'auth/wrong-password') return "Incorrect password.";
    if (code === 'auth/user-not-found') return "No account found with this email.";
    if (code === 'auth/email-already-in-use') return "This email is already registered. Please login.";
    if (code === 'auth/weak-password') return "Password should be at least 6 characters.";
    if (code === 'auth/invalid-email') return "Invalid email address.";
    if (code === 'auth/network-request-failed') return "Network error. Please checks connection.";
    return "Error: " + code;
}

// Profile Functions
function openProfileModal() {
    switchAuthView('profile');
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        const panel = document.getElementById('auth-panel');
        if (panel) panel.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function previewProfileImage(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const preview = document.getElementById('profile-img-preview');
        const placeholder = document.getElementById('profile-placeholder');
        preview.src = event.target.result;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
    };
    reader.readAsDataURL(file);
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const user = firebaseAuth.currentUser;
    if (!user) return;

    const form = e.target;
    const firstName = form.elements['firstName'].value;
    const lastName = form.elements['lastName'].value;
    const fileInput = document.getElementById('profile-upload');
    const btn = document.getElementById('profile-save-btn');
    const msgEl = document.getElementById('profile-message');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    msgEl.classList.add('hidden');

    try {
        let photoURL = user.photoURL;

        // 1. Upload Image (if selected)
        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            const storageRef = storage.ref(`customer_profiles/${user.uid}/profile_${Date.now()}`);
            const snapshot = await storageRef.put(file);
            photoURL = await snapshot.ref.getDownloadURL();
        }

        // 2. Update Auth Profile
        await user.updateProfile({
            displayName: `${firstName} ${lastName}`.trim(),
            photoURL: photoURL
        });

        // 3. Update Firestore Data
        await fs.collection('customers').doc(user.uid).update({
            firstName,
            lastName,
            photoURL,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.log("Firestore update failed (non-critical):", err));

        msgEl.innerText = "Profile updated successfully!";
        msgEl.className = "text-center text-xs text-green-600 font-bold block mb-2";
        msgEl.classList.remove('hidden');

        // UI will be updated via onAuthStateChanged or manually calling updateAuthUI
        customer.name = `${firstName} ${lastName}`.trim();
        customer.photoURL = photoURL;
        updateAuthUI(true);

    } catch (error) {
        console.error("Profile update error:", error);
        msgEl.innerText = error.message;
        msgEl.className = "text-center text-xs text-red-500 font-bold block mb-2";
        msgEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Save Changes</span> <i class="fa-solid fa-check"></i>';
    }
}

// --- Hero Slider Logic ---
let currentHeroSlide = 0;
let heroSliderInterval;

function initHeroSlider() {
    const slides = document.querySelectorAll('.slide');
    const dotsContainer = document.getElementById('hero-dots');

    if (!slides.length) return;

    // Create Dots
    dotsContainer.innerHTML = '';
    slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = `hero-dot h-1.5 w-6 rounded-full bg-white/20 transition-all duration-300 ${i === 0 ? 'active' : ''}`;
        dot.onclick = () => showHeroSlide(i);
        dotsContainer.appendChild(dot);
    });

    // Start Auto-play
    startHeroAutoplay();
}

function showHeroSlide(index) {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.hero-dot');

    if (index >= slides.length) index = 0;
    if (index < 0) index = slides.length - 1;

    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));

    slides[index].classList.add('active');
    dots[index].classList.add('active');

    currentHeroSlide = index;
    startHeroAutoplay(); // Reset timer
}

function nextHeroSlide() {
    showHeroSlide(currentHeroSlide + 1);
}

function prevHeroSlide() {
    showHeroSlide(currentHeroSlide - 1);
}

function startHeroAutoplay() {
    clearInterval(heroSliderInterval);
    heroSliderInterval = setInterval(nextHeroSlide, 5000);
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
    updateCartBadge();
    initHeroSlider();

    // Live Clock
    setInterval(() => {
        const now = new Date();
        const timeEl = document.getElementById('live-time');
        const dateEl = document.getElementById('live-date');

        if (timeEl) timeEl.innerText = now.toLocaleTimeString();
        if (dateEl) {
            dateEl.innerText = now.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric'
            });
        }
    }, 1000);
});
