'use client';

const DATABASE_NAME = 'personal-generative-studio-library-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'creative-elements';
export const LIBRARY_CHANGED_EVENT = 'personal-studio:library-changed';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

function announceChange() {
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
}

export async function listCreativeElements() {
  const elements = await transact('readonly', (store) => store.getAll());
  return elements.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function saveCreativeElement(element) {
  await transact('readwrite', (store) => store.put(element));
  announceChange();
  return element;
}

export async function deleteCreativeElement(id) {
  await transact('readwrite', (store) => store.delete(id));
  announceChange();
}

export function subscribeToCreativeLibrary(listener) {
  window.addEventListener(LIBRARY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, listener);
}
