// --- CONFIGURATION ---
// IMPORTANT: Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// --- DOM ELEMENTS ---
const tableBody = document.querySelector('#data-table tbody');
const statusMessage = document.getElementById('status-message');
const syncButton = document.getElementById('sync-button');

// Modal elements
const cameraModal = document.getElementById('camera-modal');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const clickPhotoButton = document.getElementById('click-photo');
const savePhotoButton = document.getElementById('save-photo');
const photoPreview = document.getElementById('photo-preview');
const closeButton = document.querySelector('.close-button');

// --- SUPABASE CLIENT ---
// The createClient function doesn't throw an error for invalid credentials.
// Errors will be caught when the first API call is made.
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// --- STATE ---
let currentProductId = null;
let videoStream = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (!('indexedDB' in window)) {
        console.error("This browser doesn't support IndexedDB. Offline storage will not work.");
        statusMessage.textContent = "Warning: Offline storage is not supported on this browser.";
    }

    if (supabase) {
        // Initial data fetch
        fetchProducts();
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered successfully', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    }

    // Add event listeners
    closeButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target === cameraModal) {
            closeModal();
        }
    });
});


// --- FUNCTIONS ---

// Fetch data from Supabase
async function fetchProducts() {
    statusMessage.textContent = 'Loading products...';
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        renderTable(data);
        statusMessage.textContent = 'Products loaded successfully.';
    } catch (error) {
        console.error('Error fetching products:', error.message);
        statusMessage.textContent = `Error: ${error.message}`;
    }
}

// Render data into the table
function renderTable(products) {
    tableBody.innerHTML = ''; // Clear existing data

    if (!products || products.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5">No products found.</td></tr>';
        return;
    }

    const headers = ["Account Code", "Vietnamese Name", "English Name", "UOM", "Photo"];

    products.forEach(product => {
        const row = document.createElement('tr');
        row.dataset.id = product.id;
        row.addEventListener('click', () => openModal(product.id));

        const cells = [
            product.account_code,
            product.viet_name,
            product.eng_name,
            product.uom,
            product.photo_url
        ];

        cells.forEach((cellData, index) => {
            const cell = document.createElement('td');
            cell.dataset.label = headers[index];

            if (headers[index] === 'Photo') {
                if (cellData) {
                    cell.innerHTML = `<img src="${cellData}" alt="Product Photo" class="photo-thumbnail">`;
                } else {
                    cell.textContent = 'No Photo';
                }
            } else {
                cell.textContent = cellData;
            }
            row.appendChild(cell);
        });

        tableBody.appendChild(row);
    });
}

// Open the camera modal
async function openModal(productId) {
    currentProductId = productId;

    // Reset UI
    video.style.display = 'block';
    clickPhotoButton.style.display = 'block';
    photoPreview.style.display = 'none';
    savePhotoButton.style.display = 'none';

    cameraModal.classList.add('show');

    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' } // Prefer the rear camera
        });
        video.srcObject = videoStream;
    } catch (err) {
        console.error("Error accessing camera: ", err);
        statusMessage.textContent = "Error: Could not access camera. Please grant permission.";
        closeModal();
    }
}

// Close the camera modal
function closeModal() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    cameraModal.classList.remove('show');
    videoStream = null;
    currentProductId = null;
}

// --- EVENT LISTENERS for modal buttons ---
clickPhotoButton.addEventListener('click', takePhoto);
savePhotoButton.addEventListener('click', savePhoto);

// --- INDEXEDDB ---
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('PWA_Photo_App_DB', 1);

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains('pending_photos')) {
                db.createObjectStore('pending_photos', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB initialized successfully.');
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

// Call initDB when the app loads and check for pending photos
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    updateOnlineStatus();
});


// --- ONLINE / OFFLINE & SYNC ---
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    statusMessage.textContent = isOnline ? 'You are online.' : 'You are offline. Photos will be saved locally.';
    if (isOnline) {
        syncPendingPhotos();
    } else {
        syncButton.style.display = 'none';
    }
}

syncButton.addEventListener('click', syncPendingPhotos);

function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

let isSyncing = false;
async function syncPendingPhotos() {
    if (isSyncing || !navigator.onLine) return;
    isSyncing = true;
    syncButton.textContent = 'Syncing...';
    syncButton.disabled = true;

    try {
        if (!db) await initDB();
        const transaction = db.transaction(['pending_photos'], 'readonly');
        const store = transaction.objectStore('pending_photos');
        const pendingPhotos = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (pendingPhotos.length === 0) {
            statusMessage.textContent = 'All photos are synced.';
            syncButton.style.display = 'none';
            isSyncing = false;
            return;
        }

        syncButton.style.display = 'block';
        statusMessage.textContent = `Found ${pendingPhotos.length} photo(s) to sync.`;

        for (const photo of pendingPhotos) {
            const blob = dataURLtoBlob(photo.imageData);
            const filePath = `public/${photo.productId}_${Date.now()}.jpg`;

            // 1. Upload to Storage
            const { error: uploadError } = await supabase.storage
                .from('photos')
                .upload(filePath, blob);

            if (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
            }

            // 2. Get Public URL
            const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);

            if (!urlData || !urlData.publicUrl) {
                throw new Error('Could not get public URL.');
            }
            const publicUrl = urlData.publicUrl;

            // 3. Update Database
            const { error: dbError } = await supabase
                .from('products')
                .update({ photo_url: publicUrl })
                .eq('id', photo.productId);

            if (dbError) {
                throw new Error(`Database update failed: ${dbError.message}`);
            }

            // 4. Delete from IndexedDB
            const deleteTransaction = db.transaction(['pending_photos'], 'readwrite');
            const deleteStore = deleteTransaction.objectStore('pending_photos');
            deleteStore.delete(photo.id);

            console.log(`Successfully synced photo for product ${photo.productId}`);
        }

        statusMessage.textContent = 'All pending photos have been synced!';
        fetchProducts(); // Refresh the table with new photos

    } catch (error) {
        console.error('Sync failed:', error);
        statusMessage.textContent = `Sync failed: ${error.message}. Will try again later.`;
    } finally {
        isSyncing = false;
        syncButton.textContent = 'Sync Pending Photos';
        syncButton.disabled = false;
    }
}


// --- PHOTO CAPTURE AND SAVE ---

function takePhoto() {
    const context = canvas.getContext('2d');
    // Set canvas dimensions to match video to avoid distortion
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Show preview, hide video
    video.style.display = 'none';
    clickPhotoButton.style.display = 'none';
    photoPreview.src = canvas.toDataURL('image/jpeg', 0.7); // Compression
    photoPreview.style.display = 'block';
    savePhotoButton.style.display = 'block';
}

async function savePhoto() {
    if (!currentProductId || !photoPreview.src) return;

    const photoData = {
        id: `photo_${Date.now()}`,
        productId: currentProductId,
        imageData: photoPreview.src
    };

    try {
        if (!db) {
            await initDB();
        }
        const transaction = db.transaction(['pending_photos'], 'readwrite');
        const store = transaction.objectStore('pending_photos');
        store.add(photoData);

        transaction.oncomplete = () => {
            console.log('Photo saved to IndexedDB');
            statusMessage.textContent = `Photo for product ${currentProductId} saved locally.`;
            closeModal();
            // TODO: Visually indicate that this row has a pending photo
        };
        transaction.onerror = (event) => {
            console.error('Error saving photo to DB:', event.target.error);
        };

    } catch (error) {
        console.error('Failed to save photo locally:', error);
        statusMessage.textContent = 'Error: Could not save photo for offline use.';
    }
}
