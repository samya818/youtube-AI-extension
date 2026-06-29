/**
 * @file IndexedDB wrapper for images and notebook data.
 * Images must never be stored in chrome.storage.local.
 */

/**
 * Manages IndexedDB storage for captures and notebooks.
 */
class NotebookDB {
  constructor() {
    this.db = null;
    this.DB_NAME = 'YTAITutorDB';
    this.VERSION = 3;
  }

  /**
   * Opens or upgrades the IndexedDB database.
   * @returns {Promise<void>}
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.VERSION);
      let legacyRecords = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.migrateLegacyRecords(legacyRecords).then(() => resolve()).catch(reject);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const tx = event.target.transaction;

        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }

        if (event.oldVersion < 3) {
          // If notebooks store exists from v2, read legacy records to migrate them
          if (db.objectStoreNames.contains('notebooks')) {
            const legacyStore = tx.objectStore('notebooks');
            const legacyReq = legacyStore.getAll();
            legacyReq.onsuccess = () => {
              // Store legacy records for migration in onsuccess
              legacyRecords = legacyReq.result || [];
            };
            legacyReq.onerror = () => {
              legacyRecords = [];
            };
            db.deleteObjectStore('notebooks');
          }

          if (db.objectStoreNames.contains('notebookEntries')) {
            db.deleteObjectStore('notebookEntries');
          }
        }

        if (!db.objectStoreNames.contains('notebooks')) {
          const notebooksStore = db.createObjectStore('notebooks', { keyPath: 'id' });
          notebooksStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          notebooksStore.createIndex('title', 'title', { unique: false });
        }

        if (!db.objectStoreNames.contains('notebookEntries')) {
          const entriesStore = db.createObjectStore('notebookEntries', { keyPath: 'id' });
          entriesStore.createIndex('notebookId', 'notebookId', { unique: false });
          entriesStore.createIndex('createdAt', 'createdAt', { unique: false });
          entriesStore.createIndex('videoId', 'videoId', { unique: false });
        }
      };
    });
  }

  async migrateLegacyRecords(records) {
    if (!this.db || !Array.isArray(records) || records.length === 0) {
      return;
    }

    const tx = this.db.transaction(['notebooks', 'notebookEntries'], 'readwrite');
    const notebookStore = tx.objectStore('notebooks');
    const entryStore = tx.objectStore('notebookEntries');

    for (const record of records) {
      // In the old structure, records represented video notebooks.
      // record has: videoId, videoTitle, channel, createdAt, lastAccessed, moments[]
      const notebookId = generateUUID();
      const now = new Date().toISOString();
      const notebook = {
        id: notebookId,
        title: record.videoTitle || 'Notebook migré',
        description: record.channel || 'Migré depuis l’ancien système',
        createdAt: record.createdAt || now,
        updatedAt: record.lastAccessed || now,
        color: '#7c93ff'
      };

      notebookStore.put(notebook);

      const moments = Array.isArray(record.moments) ? record.moments : [];
      moments.forEach((moment) => {
        const entry = {
          id: moment.id || generateUUID(),
          notebookId,
          type: 'chat',
          createdAt: moment.createdAt || now,
          question: moment.conversation?.find((message) => message.role === 'user')?.content || '',
          answer: moment.conversation?.find((message) => message.role === 'assistant')?.content || '',
          explanationLevel: moment.explanationLevel || 'Licence',
          overlay: moment.conversation?.find((message) => message.role === 'assistant')?.overlay || null,
          videoId: record.videoId || null,
          videoTitle: record.videoTitle || null,
          videoUrl: record.videoId ? `https://www.youtube.com/watch?v=${record.videoId}` : null,
          timestamp: moment.timestamp || 0,
          humanTime: moment.humanTime || formatTime(moment.timestamp || 0),
          imageId: moment.frames?.t0?.imageId || null,
          imageDataUrl: null,
          transcriptExcerpt: null
        };
        entryStore.put(entry);
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Stores an image data URL by ID.
   * @param {string} id
   * @param {string} dataUrl
   * @returns {Promise<void>}
   */
  async storeImage(id, dataUrl) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const request = store.put({ id, dataUrl, storedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieves an image data URL by ID.
   * @param {string} id
   * @returns {Promise<string|null>}
   */
  async getImage(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result?.dataUrl || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Deletes an image by ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteImage(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async createNotebook({ title, description = '', color = '#7c93ff' }) {
    const notebook = {
      id: generateUUID(),
      title: title?.trim() || 'Nouveau notebook',
      description: description?.trim() || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      color
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebooks', 'readwrite');
      const store = tx.objectStore('notebooks');
      const request = store.put(notebook);
      request.onsuccess = () => resolve(notebook);
      request.onerror = () => reject(request.error);
    });
  }

  async updateNotebook(notebookId, updates) {
    const notebook = await this.getNotebookById(notebookId);
    if (!notebook) {
      return false;
    }

    const updated = {
      ...notebook,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebooks', 'readwrite');
      const store = tx.objectStore('notebooks');
      const request = store.put(updated);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNotebook(notebookId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['notebooks', 'notebookEntries'], 'readwrite');
      const notebookStore = tx.objectStore('notebooks');
      const entryStore = tx.objectStore('notebookEntries');
      const entriesReq = entryStore.index('notebookId').getAll(IDBKeyRange.only(notebookId));

      entriesReq.onsuccess = () => {
        const entries = entriesReq.result || [];
        entries.forEach((entry) => entryStore.delete(entry.id));
        notebookStore.delete(notebookId);
      };
      entriesReq.onerror = () => reject(entriesReq.error);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async listNotebooks() {
    return this.getAllNotebooks();
  }

  async getNotebookById(notebookId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebooks', 'readonly');
      const store = tx.objectStore('notebooks');
      const request = store.get(notebookId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async addEntryToNotebook(notebookId, entry) {
    const entryRecord = {
      id: entry.id || generateUUID(),
      notebookId,
      type: entry.type || 'note',
      createdAt: entry.createdAt || new Date().toISOString(),
      question: entry.question || null,
      answer: entry.answer || null,
      explanationLevel: entry.explanationLevel || null,
      overlay: entry.overlay || null,
      noteText: entry.noteText || null,
      videoId: entry.videoId || null,
      videoTitle: entry.videoTitle || null,
      videoUrl: entry.videoUrl || null,
      timestamp: entry.timestamp ?? 0,
      humanTime: entry.humanTime || formatTime(entry.timestamp || 0),
      imageId: entry.imageId || null,
      imageDataUrl: entry.imageDataUrl || null,
      transcriptExcerpt: entry.transcriptExcerpt || null
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['notebooks', 'notebookEntries'], 'readwrite');
      const notebookStore = tx.objectStore('notebooks');
      const entryStore = tx.objectStore('notebookEntries');
      const getReq = notebookStore.get(notebookId);

      getReq.onsuccess = () => {
        const notebook = getReq.result;
        if (notebook) {
          notebook.updatedAt = new Date().toISOString();
          notebookStore.put(notebook);
        }
        const putReq = entryStore.put(entryRecord);
        putReq.onsuccess = () => resolve(entryRecord);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async updateNotebookEntry(entryId, updates) {
    const entry = await this.getNotebookEntryById(entryId);
    if (!entry) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebookEntries', 'readwrite');
      const store = tx.objectStore('notebookEntries');
      const request = store.put({ ...entry, ...updates });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNotebookEntry(entryId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebookEntries', 'readwrite');
      const store = tx.objectStore('notebookEntries');
      const request = store.delete(entryId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getNotebookEntries(notebookId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebookEntries', 'readonly');
      const store = tx.objectStore('notebookEntries');
      const request = store.index('notebookId').getAll(IDBKeyRange.only(notebookId));
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
      request.onerror = () => reject(request.error);
    });
  }

  async getNotebookEntryById(entryId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebookEntries', 'readonly');
      const store = tx.objectStore('notebookEntries');
      const request = store.get(entryId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Appends a moment to a video notebook.
   * @param {string} videoId
   * @param {string} videoTitle
   * @param {string} channel
   * @param {object} moment
   * @returns {Promise<void>}
   */
  async saveNotebook(videoId, videoTitle, channel, moment) {
    const existingNotebooks = await this.getAllNotebooks();
    const existing = existingNotebooks.find((nb) => nb.title === (videoTitle || 'Notebook migré'));

    if (existing) {
      const entry = {
        id: moment.id || generateUUID(),
        notebookId: existing.id,
        type: 'chat',
        createdAt: moment.createdAt || new Date().toISOString(),
        question: moment.conversation?.find((message) => message.role === 'user')?.content || '',
        answer: moment.conversation?.find((message) => message.role === 'assistant')?.content || '',
        explanationLevel: moment.explanationLevel || 'Licence',
        overlay: moment.conversation?.find((message) => message.role === 'assistant')?.overlay || null,
        videoId,
        videoTitle: videoTitle || null,
        videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
        timestamp: moment.timestamp || 0,
        humanTime: moment.humanTime || formatTime(moment.timestamp || 0),
        imageId: moment.frames?.t0?.imageId || null,
        imageDataUrl: null,
        transcriptExcerpt: null
      };
      await this.addEntryToNotebook(existing.id, entry);
      return;
    }

    const notebook = await this.createNotebook({
      title: videoTitle || 'Notebook vidéo',
      description: channel || 'Conversation sauvegardée',
      color: '#7c93ff'
    });

    const entry = {
      id: moment.id || generateUUID(),
      notebookId: notebook.id,
      type: 'chat',
      createdAt: moment.createdAt || new Date().toISOString(),
      question: moment.conversation?.find((message) => message.role === 'user')?.content || '',
      answer: moment.conversation?.find((message) => message.role === 'assistant')?.content || '',
      explanationLevel: moment.explanationLevel || 'Licence',
      overlay: moment.conversation?.find((message) => message.role === 'assistant')?.overlay || null,
      videoId,
      videoTitle: videoTitle || null,
      videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      timestamp: moment.timestamp || 0,
      humanTime: moment.humanTime || formatTime(moment.timestamp || 0),
      imageId: moment.frames?.t0?.imageId || null,
      imageDataUrl: null,
      transcriptExcerpt: null
    };
    await this.addEntryToNotebook(notebook.id, entry);
  }

  /**
   * Gets a notebook by ID or video ID.
   * @param {string} videoIdOrId
   * @returns {Promise<object|null>}
   */
  async getNotebook(videoIdOrId) {
    const notebooks = await this.getAllNotebooks();
    if (!videoIdOrId) {
      return notebooks[0] || null;
    }
    return notebooks.find((nb) => nb.id === videoIdOrId || nb.title === videoIdOrId) || null;
  }

  /**
   * Returns all notebooks.
   * @returns {Promise<object[]>}
   */
  async getAllNotebooks() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('notebooks', 'readonly');
      const store = tx.objectStore('notebooks');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)));
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Searches notebooks by query string.
   * @param {string} query
   * @returns {Promise<object[]>}
   */
  async searchNotebooks(query) {
    const all = await this.getAllNotebooks();
    const q = (query || '').toLowerCase();
    return all.filter((nb) =>
      (nb.title || '').toLowerCase().includes(q) ||
      (nb.description || '').toLowerCase().includes(q)
    );
  }
}

const notebookDB = new NotebookDB();
