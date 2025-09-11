// --- CONFIGURATION ---
const SUPABASE_URL = 'https://nlxsuuxssbbyveoewmny.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5seHN1dXhzc2JieXZlb2V3bW55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjg4MzQsImV4cCI6MjA3MDc0NDgzNH0.aKCUDelPVKJ6k0-DrpaeR13CfCjIR1LOCDq6gj-7QvM';

// --- DOM ELEMENTS ---
const tableBody = document.querySelector('#data-table tbody');
const statusMessage = document.getElementById('status-message');
const syncButton = document.getElementById('sync-button');

// Photo elements
const photoInput = document.getElementById('photo-input');
const canvas = document.getElementById('canvas');
const photoViewModal = document.getElementById('photo-view-modal');
const fullPhotoView = document.getElementById('full-photo-view');
const viewModalCloseButton = document.getElementById('view-modal-close-button');
const retakePhotoButton = document.getElementById('retake-photo-button');

// --- SUPABASE CLIENT ---
// The createClient function doesn't throw an error for invalid credentials.
// Errors will be caught when the first API call is made.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// --- STATE ---
let currentProductId = null;
let oldPhotoUrlToDelete = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (!('indexedDB' in window)) {
        console.error("This browser doesn't support IndexedDB. Offline storage will not work.");
        statusMessage.textContent = "Warning: Offline storage is not supported on this browser.";
    }

    if (supabaseClient) {
        // Initial data fetch
        fetchProducts();
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered successfully', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    }

    // Add event listeners
    photoInput.addEventListener('change', handlePhotoTaken);
    viewModalCloseButton.addEventListener('click', () => photoViewModal.classList.remove('show'));
    retakePhotoButton.addEventListener('click', handleRetakePhoto);
});


// --- FUNCTIONS ---

// Fetch data from Supabase
async function fetchProducts() {
    statusMessage.textContent = 'Loading products...';
    try {
        const { data, error } = await supabaseClient
            .from('packaging_material')
            .select('*')
            .order('id', { ascending: true });

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
        tableBody.innerHTML = '<tr><td colspan="3">No products found.</td></tr>';
        return;
    }

    const headers = ["Name", "UOM", "Photo"];

    products.forEach(product => {
        const row = document.createElement('tr');
        row.dataset.id = product.id;
        row.addEventListener('click', () => {
            if (product.photo_url) {
                // If photo exists, open the view modal
                openViewModal(product);
            } else {
                // Otherwise, trigger the photo capture for a new photo
                currentProductId = product.id;
                oldPhotoUrlToDelete = null; // Ensure we're not deleting anything
                photoInput.click();
            }
        });

        const cells = [
            product.viet_name,
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

            if (headers[index] === 'Name') {
                cell.classList.add('viet-name-cell');
            }
            row.appendChild(cell);
        });

        tableBody.appendChild(row);
    });
}

function openViewModal(product) {
    currentProductId = product.id;
    oldPhotoUrlToDelete = product.photo_url; // Set the URL to delete if user retakes
    fullPhotoView.src = product.photo_url;
    photoViewModal.classList.add('show');
}

function handleRetakePhoto() {
    photoViewModal.classList.remove('show');
    photoInput.click(); // Trigger the native camera
}

// This function will be called when the user selects a file
async function handlePhotoTaken(event) {
    const file = event.target.files[0];
    if (!file || !currentProductId) {
        return;
    }

    statusMessage.textContent = 'Compressing image...';

    try {
        const compressedDataUrl = await compressImage(file);
        await savePhotoToDB(currentProductId, compressedDataUrl, oldPhotoUrlToDelete);
    } catch (error) {
        console.error('Failed to process photo:', error);
        statusMessage.textContent = `Error: ${error.message}`;
    } finally {
        // Reset the input value and the URL to delete
        event.target.value = '';
        oldPhotoUrlToDelete = null;
    }
}

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const ctx = canvas.getContext('2d');

                // --- Compression logic ---
                // You can adjust MAX_WIDTH/MAX_HEIGHT to control the size
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 800;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                // Get the compressed data URL (e.g., JPEG with 70% quality)
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                resolve(dataUrl);
            };
            img.onerror = (error) => reject(error);
            img.src = event.target.result;
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
}

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


// --- ONLINE / OFFLLINE & SYNC ---
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    statusMessage.textContent = isOnline ? 'You are online.' : 'You are offline. Photos will be saved locally.';
    updateSyncUIVisibility();
}

syncButton.addEventListener('click', syncPendingPhotos);

async function updateSyncUIVisibility() {
    if (!db) {
        // DB might not be initialized yet, this will be called again later
        return;
    }
    try {
        const transaction = db.transaction(['pending_photos'], 'readonly');
        const store = transaction.objectStore('pending_photos');
        const countRequest = store.count();
        countRequest.onsuccess = () => {
            const count = countRequest.result;
            if (count > 0 && navigator.onLine) {
                syncButton.style.display = 'block';
                syncButton.textContent = `Sync ${count} Pending Photo(s)`;
            } else {
                syncButton.style.display = 'none';
            }
        };
        countRequest.onerror = (event) => {
            console.error("Could not count pending photos:", event.target.error);
            syncButton.style.display = 'none';
        };
    } catch (error) {
        console.error("Error accessing IndexedDB for UI update:", error);
        syncButton.style.display = 'none';
    }
}

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
            // This case should ideally not be hit if the button isn't visible, but as a safeguard:
            isSyncing = false;
            updateSyncUIVisibility();
            return;
        }

        statusMessage.textContent = `Syncing ${pendingPhotos.length} photo(s)...`;

        for (const photo of pendingPhotos) {
            console.log(`--- Syncing photo for product ID: ${photo.productId} ---`);

            // Step 0: Delete the old photo if it exists
            if (photo.oldPhotoUrlToDelete) {
                try {
                    const oldFilePath = new URL(photo.oldPhotoUrlToDelete).pathname.split('/packaging_photo/')[1];
                    if (oldFilePath) {
                        console.log(`Deleting old photo: ${oldFilePath}`);
                        await supabaseClient.storage.from('packaging_photo').remove([oldFilePath]);
                    }
                } catch (error) {
                    console.error("Could not parse or delete old photo. It might be orphaned.", error);
                    // We continue anyway, as uploading the new photo is more important.
                }
            }

            const blob = dataURLtoBlob(photo.imageData);
            const filePath = `public/${photo.productId}_${Date.now()}.jpg`;
            console.log(`Generated file path: ${filePath}`);

            // 1. Upload to Storage
            const { error: uploadError } = await supabaseClient.storage
                .from('packaging_photo')
                .upload(filePath, blob);

            if (uploadError) {
                console.error('Upload Error:', uploadError);
                throw new Error(`Upload failed: ${uploadError.message}`);
            }
            console.log('Upload successful.');

            // 2. Get Public URL
            const { data: urlData } = supabaseClient.storage
                .from('packaging_photo')
                .getPublicUrl(filePath);

            if (!urlData || !urlData.publicUrl) {
                console.error('Could not get public URL.');
                throw new Error('Could not get public URL.');
            }
            const publicUrl = urlData.publicUrl;
            console.log(`Got public URL: ${publicUrl}`);

            // 3. Update Database
            console.log(`Updating database for product ID: ${photo.productId}`);
            const { data: updateData, error: dbError } = await supabaseClient
                .from('packaging_material')
                .update({ photo_url: publicUrl })
                .eq('id', photo.productId)
                .select(); // Use .select() to get the updated row back and confirm the change

            if (dbError) {
                console.error('Database Update Error:', dbError);
                throw new Error(`Database update failed: ${dbError.message}`);
            }
            console.log('Database update successful. Response:', updateData);

            // 4. Delete from IndexedDB
            const deleteTransaction = db.transaction(['pending_photos'], 'readwrite');
            const deleteStore = deleteTransaction.objectStore('pending_photos');
            deleteStore.delete(photo.id);

            console.log(`--- Successfully synced and removed local photo for product ${photo.productId} ---`);
        }

        statusMessage.textContent = 'All pending photos have been synced!';
        fetchProducts(); // Refresh the table with new photos

    } catch (error) {
        console.error('Sync failed:', error);
        statusMessage.textContent = `Sync failed: ${error.message}. Will try again later.`;
    } finally {
        isSyncing = false;
        syncButton.disabled = false;
        updateSyncUIVisibility();
    }
}


// --- PHOTO SAVE ---

async function savePhotoToDB(productId, imageData, oldPhotoUrl = null) {
    const photoData = {
        id: `photo_${Date.now()}`,
        productId: productId,
        imageData: imageData,
        oldPhotoUrlToDelete: oldPhotoUrl
    };

    try {
        if (!db) {
            await initDB();
        }
        const transaction = db.transaction(['pending_photos'], 'readwrite');
        const store = transaction.objectStore('pending_photos');
        store.add(photoData);

        transaction.oncomplete = () => {
            console.log(`Photo for product ${productId} saved to IndexedDB.`);
            statusMessage.textContent = `Photo saved locally.`;
            updateSyncUIVisibility();

            // Update the UI to show the pending status
            const row = document.querySelector(`tr[data-id='${productId}']`);
            if (row) {
                const photoCell = row.querySelector('td:last-child');
                if (photoCell) {
                    photoCell.textContent = 'Waiting Sync';
                    photoCell.classList.add('pending-upload');
                }
            }
        };
        transaction.onerror = (event) => {
            console.error('Error saving photo to DB:', event.target.error);
            statusMessage.textContent = 'Error: Could not save photo locally.';
        };

    } catch (error) {
        console.error('Failed to save photo locally:', error);
        statusMessage.textContent = 'Error: Could not save photo for offline use.';
    }
}
