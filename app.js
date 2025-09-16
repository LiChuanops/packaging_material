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
const viewModalCloseButton = document.getElementById('view-modal-close-button');
const addPhotoButton = document.getElementById('add-photo-button');
const modalTitle = document.getElementById('modal-title');

// New elements for the photo viewer
const photoViewerContainer = document.getElementById('photo-viewer-container');
const currentPhoto = document.getElementById('current-photo');
const noPhotosMessage = document.getElementById('no-photos-message');
const prevPhotoButton = document.getElementById('prev-photo-button');
const nextPhotoButton = document.getElementById('next-photo-button');
const photoActionsContainer = document.getElementById('photo-actions-container');
const replacePhotoButton = document.getElementById('replace-photo-button');
const deletePhotoButton = document.getElementById('delete-photo-button');


// --- SUPABASE CLIENT ---
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE ---
let currentProductId = null;
let currentPhotos = [];
let currentPhotoIndex = 0; // New state for the viewer
let photoToDeleteId = null; // For tracking which photo to delete when retaking
let isSyncing = false; // Global sync flag


// --- INDEXEDDB ---
let db;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (!('indexedDB' in window)) {
        console.error("This browser doesn't support IndexedDB. Offline storage will not work.");
        statusMessage.textContent = "Warning: Offline storage is not supported on this browser.";
        // Hide sync button if IndexedDB is not supported
        if(syncButton) syncButton.style.display = 'none';
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered successfully', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    }

    // Add event listeners for UI elements
    photoInput.addEventListener('change', handlePhotoTaken);
    viewModalCloseButton.addEventListener('click', closePhotoModal);
    addPhotoButton.addEventListener('click', () => {
        photoToDeleteId = null; // New photo, not replacing
        photoInput.click();
    });
    prevPhotoButton.addEventListener('click', () => {
        if (currentPhotoIndex > 0) {
            currentPhotoIndex--;
            showPhoto(currentPhotoIndex);
        }
    });
    nextPhotoButton.addEventListener('click', () => {
        if (currentPhotoIndex < currentPhotos.length - 1) {
            currentPhotoIndex++;
            showPhoto(currentPhotoIndex);
        }
    });
    replacePhotoButton.addEventListener('click', () => {
        if (currentPhotos.length > 0 && currentPhotos[currentPhotoIndex]) {
            const photo = currentPhotos[currentPhotoIndex];
            retakePhoto(photo.id, photo.image_url);
        }
    });
    deletePhotoButton.addEventListener('click', () => {
        if (currentPhotos.length > 0 && currentPhotos[currentPhotoIndex]) {
            const photo = currentPhotos[currentPhotoIndex];
            deletePhoto(photo.id);
        }
    });
    syncButton.addEventListener('click', syncAllData);

    // Initialize IndexedDB and then load initial data
    initDB().then(() => {
        loadInitialData();
    }).catch(err => {
        console.error("Failed to initialize DB:", err);
        // Fallback to network if DB fails
        if(navigator.onLine) {
            fetchProducts();
        } else {
            statusMessage.textContent = "Error: Could not access local storage."
        }
    });
});

// --- FUNCTIONS ---

async function loadInitialData() {
    if (!db) {
        console.log('DB not ready, trying to fetch from network.');
        if (navigator.onLine) {
            fetchProducts();
        } else {
            statusMessage.textContent = "You are offline and no local data is available.";
        }
        return;
    }

    // 1. Try to load from cache first
    try {
        const transaction = db.transaction(['products_cache'], 'readonly');
        const store = transaction.objectStore('products_cache');
        const request = store.getAll();

        request.onsuccess = () => {
            const cachedProducts = request.result;
            if (cachedProducts && cachedProducts.length > 0) {
                console.log('Rendering table from cached products.');
                renderTable(cachedProducts);
                statusMessage.textContent = 'Showing cached data. Checking for updates...';
            } else {
                 statusMessage.textContent = 'No cached data found. Trying to fetch from network...';
            }

            // 2. Then, fetch from network if online to get latest data
            if (navigator.onLine) {
                console.log('Fetching latest products from network.');
                fetchProducts();
            } else {
                if (!cachedProducts || cachedProducts.length === 0) {
                    statusMessage.textContent = 'You are offline and no data is cached.';
                } else {
                    statusMessage.textContent = 'You are offline. Displaying cached data.';
                }
            }
        };
        request.onerror = (event) => {
            console.error('Error reading from cache:', event.target.error);
            if (navigator.onLine) {
                fetchProducts();
            }
        };
    } catch (error) {
        console.error('Error accessing products_cache:', error);
        if (navigator.onLine) {
            fetchProducts();
        }
    }
}


// Fetch data from Supabase with photos
async function fetchProducts() {
    if (!navigator.onLine) {
        statusMessage.textContent = 'You are offline. Cannot fetch new data.';
        return;
    }

    statusMessage.textContent = 'Loading products...';
    try {
        // Fetch materials with their photos
        const { data: materials, error: materialError } = await supabaseClient
            .from('packaging_material')
            .select(`
                *,
                packaging_photo (
                    id,
                    image_url,
                    created_at
                )
            `)
            .order('id', { ascending: true });

        if (materialError) {
            throw materialError;
        }

        // --- Caching logic ---
        if (db && materials) {
            try {
                const transaction = db.transaction(['products_cache'], 'readwrite');
                const store = transaction.objectStore('products_cache');
                store.clear(); // Clear old cache
                for (const product of materials) {
                    store.put(product); // Use put to add/update
                }
                transaction.oncomplete = () => {
                    console.log('Products cached successfully.');
                };
                transaction.onerror = (event) => {
                    console.error('Error caching products:', event.target.error);
                };
            } catch(e) {
                console.error("Error while trying to cache products", e);
            }
        }
        // --- Caching logic ends ---

        renderTable(materials);
        statusMessage.textContent = 'Products loaded successfully.';
    } catch (error) {
        console.error('Error fetching products:', error.message);
        statusMessage.textContent = `Error fetching products. Displaying cached data if available.`;
    }
}

// Render data into the table
function renderTable(products) {
    tableBody.innerHTML = ''; // Clear existing data

    if (!products || products.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4">No products found.</td></tr>';
        return;
    }

    products.forEach(product => {
        const row = document.createElement('tr');
        row.dataset.id = product.id;

        // Create cells in order
        const nameCell = document.createElement('td');
        nameCell.dataset.label = "Name";
        nameCell.textContent = product.viet_name;
        nameCell.classList.add('viet-name-cell');
        row.appendChild(nameCell);

        const uomCell = document.createElement('td');
        uomCell.dataset.label = "UOM";
        uomCell.textContent = product.uom;
        row.appendChild(uomCell);

        const weightCell = document.createElement('td');
        weightCell.dataset.label = "Weight";
        weightCell.classList.add('weight-cell'); // Add class for styling
        const weightInput = document.createElement('input');
        weightInput.type = 'number';
        weightInput.value = product.weight === null || product.weight === undefined ? '' : product.weight;
        weightInput.placeholder = 'N/A';
        weightInput.dataset.productId = product.id;
        weightInput.addEventListener('change', handleWeightChange);
        weightCell.appendChild(weightInput);
        row.appendChild(weightCell);

        const photoCell = document.createElement('td');
        photoCell.dataset.label = "Photos";
        const photoCount = product.packaging_photo ? product.packaging_photo.length : 0;
        if (photoCount > 0) {
            photoCell.innerHTML = `<span class="photo-count">${photoCount} photo(s)</span>`;
            if (product.packaging_photo[0].image_url) {
                photoCell.innerHTML += `<img src="${product.packaging_photo[0].image_url}" alt="Product Photo" class="photo-thumbnail">`;
            }
        } else {
            photoCell.innerHTML = '<span class="no-photos">No Photos</span>';
        }
        photoCell.addEventListener('click', () => openPhotoModal(product));
        row.appendChild(photoCell);

        tableBody.appendChild(row);
    });
}

async function handleWeightChange(event) {
    const input = event.target;
    const productId = input.dataset.productId;
    const newWeight = input.value.trim() === '' ? null : parseFloat(input.value);

    if (input.value.trim() !== '' && isNaN(newWeight)) {
        statusMessage.textContent = 'Invalid weight. Please enter a number.';
        // Revert to old value
        const { data, error } = await supabaseClient.from('packaging_material').select('weight').eq('id', productId).single();
        if (!error) {
            input.value = data.weight || '';
        }
        return;
    }

    statusMessage.textContent = 'Saving weight change...';
    try {
        await saveWeightUpdate(productId, newWeight);
        if (navigator.onLine) {
            await syncAllData();
        }
    } catch (error) {
        statusMessage.textContent = `Error saving weight: ${error.message}`;
    }
}

function showPhoto(index) {
    if (!currentPhotos || currentPhotos.length === 0) {
        currentPhoto.style.display = 'none';
        noPhotosMessage.style.display = 'block';
        photoActionsContainer.style.display = 'none';
        prevPhotoButton.style.display = 'none';
        nextPhotoButton.style.display = 'none';
        return;
    }

    currentPhoto.style.display = 'block';
    noPhotosMessage.style.display = 'none';
    photoActionsContainer.style.display = 'flex';

    const photo = currentPhotos[index];
    currentPhoto.src = photo.image_url;
    currentPhoto.alt = `Photo ${index + 1}`;

    prevPhotoButton.style.display = index > 0 ? 'block' : 'none';
    nextPhotoButton.style.display = index < currentPhotos.length - 1 ? 'block' : 'none';
}

function openPhotoModal(product) {
    currentProductId = product.id;
    currentPhotos = product.packaging_photo || [];
    currentPhotoIndex = 0;
    
    modalTitle.textContent = `Photos for ${product.viet_name}`;
    
    showPhoto(currentPhotoIndex);
    
    if (currentPhotos.length < 3) {
        addPhotoButton.style.display = 'block';
    } else {
        addPhotoButton.style.display = 'none';
    }
    
    photoViewModal.classList.add('show');
}

function closePhotoModal() {
    photoViewModal.classList.remove('show');
    currentProductId = null;
    currentPhotos = [];
    currentPhotoIndex = 0;
    photoToDeleteId = null;
}

function retakePhoto(photoId, imageUrl) {
    photoToDeleteId = photoId;
    photoInput.click();
}

async function deletePhoto(photoId) {
    if (!confirm('Are you sure you want to delete this photo?')) {
        return;
    }

    try {
        statusMessage.textContent = 'Deleting photo...';
        
        // Get photo details first
        const { data: photo, error: fetchError } = await supabaseClient
            .from('packaging_photo')
            .select('image_url')
            .eq('id', photoId)
            .single();

        if (fetchError) {
            throw fetchError;
        }

        // Delete from storage
        if (photo.image_url) {
            const filePath = new URL(photo.image_url).pathname.split('/packaging_photo/')[1];
            if (filePath) {
                await supabaseClient.storage.from('packaging_photo').remove([filePath]);
            }
        }

        // Delete from database
        const { error: deleteError } = await supabaseClient
            .from('packaging_photo')
            .delete()
            .eq('id', photoId);

        if (deleteError) {
            throw deleteError;
        }

        statusMessage.textContent = 'Photo deleted successfully.';
        
        // Refresh the current product data
        const { data: updatedProduct } = await supabaseClient
            .from('packaging_material')
            .select(
                `*,
                packaging_photo (
                    id,
                    image_url,
                    created_at
                )`
            )
            .eq('id', currentProductId)
            .single();

        if (updatedProduct) {
            openPhotoModal(updatedProduct);
        }
        
        // Refresh table
        fetchProducts();
        
    } catch (error) {
        console.error('Error deleting photo:', error);
        statusMessage.textContent = `Error deleting photo: ${error.message}`;
    }
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
        await savePhotoToDB(currentProductId, compressedDataUrl, photoToDeleteId);
    } catch (error) {
        console.error('Failed to process photo:', error);
        statusMessage.textContent = `Error: ${error.message}`;
    } finally {
        // Reset the input value
        event.target.value = '';
        photoToDeleteId = null;
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

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('PWA_Photo_App_DB', 4); // Version 4

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            if (!db.objectStoreNames.contains('pending_photos')) {
                const photoStore = db.createObjectStore('pending_photos', { keyPath: 'id' });
                photoStore.createIndex('productId', 'productId', { unique: false });
            }

            if (!db.objectStoreNames.contains('pending_updates')) {
                const updateStore = db.createObjectStore('pending_updates', { keyPath: 'id' });
                updateStore.createIndex('productId', 'productId', { unique: false });
            }

            if (!db.objectStoreNames.contains('products_cache')) {
                const productStore = db.createObjectStore('products_cache', { keyPath: 'id' });
                productStore.createIndex('viet_name', 'viet_name', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB initialized successfully.');
            updateOnlineStatus();
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

// --- ONLINE / OFFLINE & SYNC ---
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    statusMessage.textContent = isOnline ? 'You are online.' : 'You are offline. Data will be saved locally.';
    updateSyncUIVisibility();
}

async function updateSyncUIVisibility() {
    if (!db) return;

    const count = async (storeName) => {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(storeName)) {
                resolve(0);
                return;
            }
            try {
                const transaction = db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    };

    try {
        const photoCount = await count('pending_photos');
        const updateCount = await count('pending_updates');
        const totalCount = photoCount + updateCount;

        if (totalCount > 0 && navigator.onLine) {
            syncButton.style.display = 'block';
            syncButton.textContent = `Sync ${totalCount} Pending Item(s)`;
        } else {
            syncButton.style.display = 'none';
        }
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

async function syncAllData() {
    if (isSyncing || !navigator.onLine) return;
    isSyncing = true;
    syncButton.textContent = 'Syncing...';
    syncButton.disabled = true;

    try {
        await syncPendingUpdates();
        await syncPendingPhotos();

        statusMessage.textContent = 'All pending items have been synced!';
        fetchProducts(); // Refresh the table with new data

    } catch (error) {
        console.error('Sync failed:', error);
        statusMessage.textContent = `Sync failed: ${error.message}. Will try again later.`;
    } finally {
        isSyncing = false;
        syncButton.disabled = false;
        updateSyncUIVisibility();
    }
}

async function syncPendingUpdates() {
    if (!db) await initDB();
    if (!db.objectStoreNames.contains('pending_updates')) return;

    const transaction = db.transaction(['pending_updates'], 'readonly');
    const store = transaction.objectStore('pending_updates');
    const pendingUpdates = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    if (pendingUpdates.length > 0) {
        console.log(`Syncing ${pendingUpdates.length} weight update(s)...`);

        for (const update of pendingUpdates) {
            console.log(`--- Syncing weight for product ID: ${update.productId} ---`);

            const { error } = await supabaseClient
                .from('packaging_material')
                .update({ weight: update.weight })
                .eq('id', update.productId);

            if (error) {
                console.error('Update Error:', error);
                throw new Error(`Update failed: ${error.message}`);
            }

            console.log('Update successful.');

            const deleteTransaction = db.transaction(['pending_updates'], 'readwrite');
            const deleteStore = deleteTransaction.objectStore('pending_updates');
            deleteStore.delete(update.id);
            console.log(`--- Successfully synced and removed local update for product ${update.productId} ---`);
        }
    }
}

async function syncPendingPhotos() {
    if (!db) await initDB();
    if (!db.objectStoreNames.contains('pending_photos')) return;

    const transaction = db.transaction(['pending_photos'], 'readonly');
    const store = transaction.objectStore('pending_photos');
    const pendingPhotos = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    if (pendingPhotos.length > 0) {
        console.log(`Syncing ${pendingPhotos.length} photo(s)...`);

        for (const photo of pendingPhotos) {
            console.log(`--- Syncing photo for product ID: ${photo.productId} ---`);

            // Step 0: Delete the old photo if it's a replacement
            if (photo.photoToDeleteId) {
                try {
                    // Get the photo to delete
                    const { data: photoToDelete, error: fetchError } = await supabaseClient
                        .from('packaging_photo')
                        .select('image_url')
                        .eq('id', photo.photoToDeleteId)
                        .single();

                    if (!fetchError && photoToDelete.image_url) {
                        const oldFilePath = new URL(photoToDelete.image_url).pathname.split('/packaging_photo/')[1];
                        if (oldFilePath) {
                            console.log(`Deleting old photo: ${oldFilePath}`);
                            await supabaseClient.storage.from('packaging_photo').remove([oldFilePath]);
                        }
                    }

                    // Delete from database
                    await supabaseClient
                        .from('packaging_photo')
                        .delete()
                        .eq('id', photo.photoToDeleteId);
                        
                } catch (error) {
                    console.error("Could not delete old photo. It might be orphaned.", error);
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

            // 3. Insert into packaging_photo table
            console.log(`Inserting photo record for material ID: ${photo.productId}`);
            const { data: insertData, error: dbError } = await supabaseClient
                .from('packaging_photo')
                .insert({
                    material_id: photo.productId,
                    image_url: publicUrl
                })
                .select();

            if (dbError) {
                console.error('Database Insert Error:', dbError);
                throw new Error(`Database insert failed: ${dbError.message}`);
            }
            console.log('Database insert successful. Response:', insertData);

            // 4. Delete from IndexedDB
            const deleteTransaction = db.transaction(['pending_photos'], 'readwrite');
            const deleteStore = deleteTransaction.objectStore('pending_photos');
            deleteStore.delete(photo.id);

            console.log(`--- Successfully synced and removed local photo for product ${photo.productId} ---`);
        }
    }
}


// --- PHOTO SAVE ---
async function savePhotoToDB(productId, imageData, photoToDeleteId = null) {
    const photoData = {
        id: `photo_${Date.now()}`,
        productId: productId,
        imageData: imageData,
        photoToDeleteId: photoToDeleteId
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
                const photoCell = row.querySelector('td[data-label="Photos"]');
                if (photoCell) {
                    photoCell.innerHTML = '<span class="pending-upload">Waiting Sync add more photo</span>';
                }
            }
            
            // Close modal to refresh
            closePhotoModal();
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

async function saveWeightUpdate(productId, weight) {
    if (!db) await initDB();

    const updateData = {
        id: `update_${productId}_${Date.now()}`,
        productId: productId,
        weight: weight,
        timestamp: new Date().toISOString()
    };

    const transaction = db.transaction(['pending_updates'], 'readwrite');
    const store = transaction.objectStore('pending_updates');
    store.add(updateData);

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            console.log(`Weight update for product ${productId} saved to IndexedDB.`);
            statusMessage.textContent = `Weight update saved locally.`;
            updateSyncUIVisibility();
            resolve();
        };
        transaction.onerror = (event) => {
            console.error('Error saving weight update to DB:', event.target.error);
            statusMessage.textContent = 'Error: Could not save weight update locally.';
            reject(event.target.error);
        };
    });
}
