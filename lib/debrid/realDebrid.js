const axios = require('axios');
const DebridService = require('./baseService');
const { selectBestFile, isVideoFile, getFileExtension } = require('../fileUtils');

/**
 * Service de debridage Real-Debrid
 */
class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
    }

    /**
     * Vérifie si l'API key est valide
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        try {
            const response = await axios.get(`${this.baseUrl}/user`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.status === 200;
        } catch (error) {
            console.error('Erreur lors de la vérification de l\'API key Real-Debrid:', error);
            return false;
        }
    }

    /**
     * Extrait le hash d'un lien magnet
     * @param {string} magnetLink - Lien magnet
     * @returns {string|null} - Hash du torrent ou null si non trouvé
     */
    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        if (match && match[1]) {
            return match[1].toLowerCase();
        }
        return null;
    }

    /**
     * Vérifie si un torrent est déjà en cache
     * @param {string} infoHash - Hash du torrent
     * @returns {Promise<Array>} - Liste des IDs des torrents en cache
     */
    async getCachedTorrentIds(infoHash) {
        try {
            console.log(`[REALDEBRID] Recherche de torrents en cache avec le hash: ${infoHash}`);
            const response = await axios.get(`${this.baseUrl}/torrents`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            const cachedIds = [];
            for (const torrent of response.data) {
                if (torrent.hash.toLowerCase() === infoHash.toLowerCase()) {
                    cachedIds.push(torrent.id);
                }
            }

            console.log(`[REALDEBRID] Trouvé ${cachedIds.length} torrents en cache avec le hash: ${infoHash}`);
            return cachedIds;
        } catch (error) {
            console.error('Erreur lors de la recherche de torrents en cache:', error);
            return [];
        }
    }

    /**
     * Récupère les informations d'un torrent en cache
     * @param {Array} cachedIds - Liste des IDs des torrents en cache
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (toujours 'series')
     * @returns {Promise<Object|null>} - Informations sur le torrent en cache ou null
     */
    async getCachedTorrentInfo(cachedIds, fileIndex, season, episode, streamType) {
        for (const cachedId of cachedIds) {
            try {
                const torrentInfo = await this.getTorrentInfo(cachedId);
                if (this.torrentContainsFile(torrentInfo, fileIndex, season, episode, streamType)) {
                    console.log(`[REALDEBRID] Torrent en cache trouvé avec ID: ${cachedId}`);
                    return torrentInfo;
                }
            } catch (error) {
                console.error(`Erreur lors de la récupération des informations du torrent ${cachedId}:`, error);
            }
        }
        console.log('[REALDEBRID] Aucun torrent en cache trouvé avec les fichiers appropriés');
        return null;
    }

    /**
     * Vérifie si un torrent contient le fichier approprié
     * @param {Object} torrentInfo - Informations sur le torrent
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (toujours 'series')
     * @returns {boolean} - true si le torrent contient le fichier approprié
     */
    torrentContainsFile(torrentInfo, fileIndex, season, episode, streamType) {
        if (!torrentInfo || !torrentInfo.files) {
            return false;
        }

        if (streamType === 'series') {
            if (fileIndex !== null && fileIndex !== undefined) {
                return torrentInfo.files.some(file => file.id === fileIndex && file.selected === 1);
            } else {
                return torrentInfo.files.some(file => {
                    const fileName = file.path.toLowerCase();
                    const seasonPattern = new RegExp(`s0*${season}|season\\s*0*${season}`, 'i');
                    const episodePattern = new RegExp(`e0*${episode}|episode\\s*0*${episode}`, 'i');
                    return file.selected === 1 && seasonPattern.test(fileName) && episodePattern.test(fileName);
                });
            }
        }
        return false;
    }

    /**
     * Récupère les informations d'un torrent
     * @param {string} torrentId - ID du torrent
     * @returns {Promise<Object>} - Informations sur le torrent
     */
    async getTorrentInfo(torrentId) {
        try {
            console.log(`[REALDEBRID] Récupération des informations du torrent avec ID: ${torrentId}`);
            const response = await axios.get(`${this.baseUrl}/torrents/info/${torrentId}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        } catch (error) {
            console.error(`Erreur lors de la récupération des informations du torrent ${torrentId}:`, error);
            throw error;
        }
    }

    /**
     * Dérestreint un lien
     * @param {string} link - Lien à dérestreindre
     * @returns {Promise<Object>} - Informations sur le lien dérestreint
     */
    async unrestrictLink(link) {
        try {
            console.log(`[REALDEBRID] Dérestriction du lien: ${link}`);
            // Selon la documentation de l'API, le paramètre 'link' doit être envoyé en tant que paramètre POST
            const response = await axios.post(`${this.baseUrl}/unrestrict/link`,
                `link=${encodeURIComponent(link)}`, // Encoder le lien pour éviter les problèmes avec les caractères spéciaux
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded' // Format attendu par l'API
                }
            });
            console.log(`[REALDEBRID] Lien dérestreint: ${response.data.download}`);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la dérestriction du lien:', error);
            throw error;
        }
    }

    /**
     * Attend qu'un lien soit prêt
     * @param {string} torrentId - ID du torrent
     * @param {number} timeout - Timeout en secondes
     * @param {number} interval - Intervalle de vérification en secondes
     * @returns {Promise<Array|null>} - Liste des liens ou null si timeout
     */
    async waitForLink(torrentId, timeout = 30, interval = 5) {
        console.log(`[REALDEBRID] Attente des liens pour le torrent ID: ${torrentId}`);
        const startTime = Date.now();
        while (Date.now() - startTime < timeout * 1000) {
            try {
                const torrentInfo = await this.getTorrentInfo(torrentId);
                if (torrentInfo.links && torrentInfo.links.length > 0) {
                    console.log(`[REALDEBRID] Liens trouvés pour le torrent ID: ${torrentId}`);
                    return torrentInfo.links;
                }
            } catch (error) {
                console.error(`Erreur lors de la vérification des liens pour le torrent ${torrentId}:`, error);
            }
            await new Promise(resolve => setTimeout(resolve, interval * 1000));
        }
        console.log(`[REALDEBRID] Timeout atteint, aucun lien trouvé pour le torrent ID: ${torrentId}`);
        return null;
    }

    /**
     * Sélectionne les fichiers appropriés dans un torrent
     * @param {string} torrentId - ID du torrent
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (toujours 'series')
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @returns {Promise<void>}
     */
    async selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName = null) {
        try {
            console.log(`[REALDEBRID] Sélection des fichiers pour le torrent ID: ${torrentId}`);
            const torrentInfo = await this.getTorrentInfo(torrentId);
            
            // Récupérer le nom de l'épisode si disponible et non fourni
            if (!episodeName && torrentInfo.episodeName) {
                episodeName = torrentInfo.episodeName;
                console.log(`[REALDEBRID] Nom de l'épisode récupéré: "${episodeName}"`);
            }
            
            // Enrichir les fichiers avec des informations supplémentaires
            const enrichedFiles = torrentInfo.files.map(file => ({
                ...file,
                extension: getFileExtension(file.path || file.name || ''),
                isVideo: isVideoFile(file.path || file.name || '')
            }));
            
            // Utiliser la méthode de la classe de base pour sélectionner le meilleur fichier
            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, {
                fileIndex,
                streamType
            });
            
            let filesToSelect;
            if (bestFile) {
                console.log(`[REALDEBRID] Fichier sélectionné: ${bestFile.path || bestFile.name}`);
                filesToSelect = bestFile.id.toString();
            } else {
                console.log('[REALDEBRID] Aucun fichier correspondant trouvé, sélection de tous les fichiers');
                filesToSelect = 'all';
            }
            
            // Selon la documentation de l'API, le paramètre 'files' doit être envoyé en tant que paramètre POST
            // avec une valeur de type string qui est soit "all", soit une liste d'IDs séparés par des virgules
            await axios.post(`${this.baseUrl}/torrents/selectFiles/${torrentId}`,
                `files=${filesToSelect}`, // Envoyer comme données de formulaire URL-encoded
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded' // Format attendu par l'API
                    }
                }
            );
            console.log(`[REALDEBRID] Fichiers sélectionnés pour le torrent ID: ${torrentId}`);
        } catch (error) {
            console.error(`Erreur lors de la sélection des fichiers pour le torrent ${torrentId}:`, error);
            throw error;
        }
    }

    /**
     * Débrider un lien magnet
     * @param {string} magnetLink - Lien magnet à débrider
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (toujours 'series')
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @returns {Promise<Object>} - Informations sur le lien débridé
     */
    async debridMagnet(magnetLink, fileIndex = null, season = null, episode = null, streamType = 'series', episodeName = null) {
        try {
            // Extraire le hash du magnet
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) {
                throw new Error('Hash non trouvé dans le lien magnet');
            }
            
            // Vérifier si le torrent est déjà en cache
            const cachedIds = await this.getCachedTorrentIds(infoHash);
            let torrentId = null;
            
            if (cachedIds.length > 0) {
                const cachedTorrentInfo = await this.getCachedTorrentInfo(cachedIds, fileIndex, season, episode, streamType);
                if (cachedTorrentInfo) {
                    torrentId = cachedTorrentInfo.id;
                    console.log(`[REALDEBRID] Utilisation du torrent en cache avec ID: ${torrentId}`);
                }
            }
            
            // Si le torrent n'est pas en cache, l'ajouter
            if (!torrentId) {
                console.log(`[REALDEBRID] Ajout du magnet: ${magnetLink.substring(0, 50)}...`);
                
                // Selon la documentation de l'API, le paramètre 'magnet' doit être envoyé en tant que paramètre POST
                const addResponse = await axios.post(`${this.baseUrl}/torrents/addMagnet`,
                    `magnet=${encodeURIComponent(magnetLink)}`, // Encoder le magnet pour éviter les problèmes avec les caractères spéciaux
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/x-www-form-urlencoded' // Format attendu par l'API
                        }
                    }
                );
                
                torrentId = addResponse.data.id;
                console.log(`[REALDEBRID] Torrent ajouté avec ID: ${torrentId}`);
                
                // Sélectionner les fichiers appropriés
                await this.selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName);
            }
            
            // Attendre que le torrent soit prêt (avec timeout)
            let torrentInfo;
            let isReady = false;
            const startTime = Date.now();
            const timeout = 30000; // 30 secondes
            
            while (!isReady && Date.now() - startTime < timeout) {
                torrentInfo = await this.getTorrentInfo(torrentId);
                isReady = torrentInfo.status === 'downloaded';
                
                if (!isReady) {
                    console.log(`[REALDEBRID] Torrent pas encore prêt, statut: ${torrentInfo.status}`);
                    // Attendre 2 secondes avant de vérifier à nouveau
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (!isReady) {
                console.log(`[REALDEBRID] Timeout atteint, le torrent n'est pas encore prêt`);
                // Retourner un objet spécial pour indiquer que le torrent est en cours de téléchargement
                return {
                    id: torrentId,
                    name: 'Torrent en cours de téléchargement',
                    status: 'downloading',
                    files: []
                };
            }
            
            console.log(`[REALDEBRID] Torrent prêt avec ID: ${torrentId}`);
            return {
                id: torrentId,
                name: torrentInfo.filename,
                status: torrentInfo.status,
                files: torrentInfo.files
            };
        } catch (error) {
            console.error('Erreur lors du debridage du magnet avec Real-Debrid:', error);
            throw error;
        }
    }

    /**
     * Récupérer les liens de téléchargement
     * @param {string} id - ID du torrent débridé
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (toujours 'series')
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @returns {Promise<Array>} - Liste des liens de téléchargement
     */
    async getDownloadLinks(id, fileIndex = null, season = null, episode = null, streamType = 'series', episodeName = null) {
        try {
            console.log(`[REALDEBRID] Récupération des liens de téléchargement pour le torrent ID: ${id}`);
            const torrentInfo = await this.getTorrentInfo(id);
            
            if (!torrentInfo.links || torrentInfo.links.length === 0) {
                console.log(`[REALDEBRID] Aucun lien trouvé pour le torrent ID: ${id}`);
                return [];
            }
            
            // Adapter les liens pour inclure les informations de fichier
            const links = torrentInfo.links.map(link => {
                const filename = link.split('/').pop();
                return {
                    url: link,
                    filename: filename,
                    name: filename, // Pour compatibilité avec selectBestFile
                    path: filename, // Pour compatibilité avec selectBestFile
                    size: 0, // Taille inconnue pour RealDebrid
                    extension: getFileExtension(filename),
                    isVideo: isVideoFile(filename)
                };
            });
            
            // Sélectionner le fichier approprié en utilisant la méthode de la classe de base
            const selectedFile = this.selectBestFile(links, episode, episodeName, {
                fileIndex,
                streamType
            });
            
            // Si un fichier est sélectionné, le retourner, sinon retourner tous les liens
            const result = selectedFile ? [selectedFile] : links;
            
            console.log(`[REALDEBRID] ${result.length} liens de téléchargement sélectionnés`);
            return result;
        } catch (error) {
            console.error('Erreur lors de la récupération des liens de téléchargement avec Real-Debrid:', error);
            throw error;
        }
    }

    /**
     * Ajoute un lien magnet au service sans attendre la complétion ni sélectionner de fichier.
     * @param {string} magnetLink - Lien magnet à ajouter
     * @returns {Promise<string|null>} - ID du torrent ajouté ou null si déjà présent/erreur
     */
    async addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) {
                throw new Error('Hash non trouvé dans le lien magnet pour addMagnetOnly');
            }

            console.log(`[REALDEBRID ADDONLY] Tentative d'ajout du magnet: ${magnetLink.substring(0, 50)}... Ep: ${episodeNumber}, Name: ${episodeName}`);

            const addResponse = await axios.post(`${this.baseUrl}/torrents/addMagnet`,
                `magnet=${encodeURIComponent(magnetLink)}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            const torrentId = addResponse.data.id;
            console.log(`[REALDEBRID ADDONLY] Magnet ajouté/trouvé avec ID: ${torrentId}`);
            
            if (torrentId && episodeNumber) {
                console.log(`[REALDEBRID ADDONLY] Tentative de sélection de fichier post-ajout pour torrent ID: ${torrentId}, Ep: ${episodeNumber}`);
                // Non-blocking call to selectFiles
                this.selectFiles(torrentId, null, null, episodeNumber, streamType, episodeName)
                    .then(() => console.log(`[REALDEBRID ADDONLY] Sélection de fichier post-ajout initiée pour ${torrentId}`))
                    .catch(err => console.warn(`[REALDEBRID ADDONLY] Erreur (non bloquante) lors de la sélection de fichier post-ajout pour ${torrentId}: ${err.message}`));
            }
            
            return torrentId;

        } catch (error) {
            if (error.response && error.response.data && error.response.data.error_code === 2) {
                 console.warn(`[REALDEBRID ADDONLY] Erreur lors de l'ajout (Resource already created): ${error.response.data.error}. Tentative de récupération de l'ID existant.`);
                 try {
                     const existingTorrents = await this.getCachedTorrentIds(this.getInfoHashFromMagnet(magnetLink));
                     if (existingTorrents.length > 0) {
                        const existingTorrentId = existingTorrents[0];
                        console.log(`[REALDEBRID ADDONLY] ID existant trouvé: ${existingTorrentId}.`);
                        if (episodeNumber) {
                            console.log(`[REALDEBRID ADDONLY] Tentative de sélection de fichier pour torrent existant ID: ${existingTorrentId}, Ep: ${episodeNumber}`);
                            this.selectFiles(existingTorrentId, null, null, episodeNumber, streamType, episodeName)
                                .then(() => console.log(`[REALDEBRID ADDONLY] Sélection de fichier (pour existant) initiée pour ${existingTorrentId}`))
                                .catch(err => console.warn(`[REALDEBRID ADDONLY] Erreur (non bloquante) lors de la sélection (pour existant) pour ${existingTorrentId}: ${err.message}`));
                        }
                        return existingTorrentId;
                     }
                 } catch (findError) {
                    console.error(`[REALDEBRID ADDONLY] Erreur lors de la recherche de l'ID existant après erreur 'Resource already created':`, findError.message);
                 }
                 return null;
            }
            console.error(`[REALDEBRID ADDONLY] Erreur inattendue lors de l'ajout du magnet:`, error.message, error.stack);
            return null;
        }
    }

    /**
     * Vérifie l'état d'un torrent et récupère les liens si complété.
     * @param {string} magnetLink - Lien magnet à vérifier
     * @param {number|null} fileIndex - Index du fichier spécifique (si connu)
     * @param {string|null} season - Numéro de saison (si series)
     * @param {string|null} episode - Numéro d'épisode (si series)
     * @param {string} streamType - Type de contenu ('series', 'movie')
     * @param {string|null} episodeName - Nom de l'épisode (si series)
     * @returns {Promise<Object|null>} - Objet avec { status: '...', links: [...] } ou null
     */
    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) {
                throw new Error('Hash non trouvé dans le lien magnet pour getTorrentStatusAndLinks');
            }

            // 1. Find torrent ID matching the hash
            console.log(`[REALDEBRID STATUS] Searching torrent with hash: ${infoHash}, Ep: ${episodeNumber}`);
            const torrentListResponse = await axios.get(`${this.baseUrl}/torrents`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                params: { limit: 500 }
            });

            const matchingTorrents = torrentListResponse.data.filter(t => t.hash.toLowerCase() === infoHash.toLowerCase());

            if (matchingTorrents.length === 0) {
                console.log(`[REALDEBRID STATUS] No torrent found with hash: ${infoHash}`);
                return { status: 'not_found', links: [] };
            }

            // Take the most recent torrent
            const sortedTorrents = matchingTorrents.sort((a, b) => new Date(b.added) - new Date(a.added));
            const torrent = sortedTorrents[0];
            const torrentId = torrent.id;
            console.log(`[REALDEBRID STATUS] Found torrent ID: ${torrentId} (Status: ${torrent.status})`);

            // 2. Get detailed torrent info
            let torrentInfo = await this.getTorrentInfo(torrentId);

            // 3. Handle waiting_files_selection status by selecting files if we have episode info
            if (torrentInfo.status === 'waiting_files_selection' && episodeNumber) {
                console.log(`[REALDEBRID STATUS] Selecting files for torrent ID: ${torrentId}, Ep: ${episodeNumber}`);
                await this.selectFiles(torrentId, null, null, episodeNumber, streamType, episodeName);
                torrentInfo = await this.getTorrentInfo(torrentId); // Refresh info after selection
            }

            // 4. Check status
            const statusMap = {
                'magnet_error': 'error',
                'magnet_conversion': 'downloading',
                'waiting_files_selection': 'downloading',
                'queued': 'downloading',
                'downloading': 'downloading',
                'downloaded': 'completed',
                'error': 'error',
                'virus': 'error',
                'compressing': 'downloading',
                'uploading': 'downloading' // Peut prendre du temps
            };
            const currentStatus = statusMap[torrentInfo.status] || 'error'; // Défaut à 'error' si statut inconnu

            if (currentStatus !== 'completed') {
                console.log(`[REALDEBRID STATUS] Torrent ID ${torrentId} non complété. Statut RD: ${torrentInfo.status} -> Statut Mappé: ${currentStatus}`);
                return { status: currentStatus, links: [] };
            }

            // 4. Si complété, sélectionner le fichier et extraire le lien
            console.log(`[REALDEBRID STATUS] Torrent ID ${torrentId} complété. Sélection du fichier...`);

            if (!torrentInfo.files || torrentInfo.files.length === 0) {
                 console.error(`[REALDEBRID STATUS] Torrent ID ${torrentId} complété mais sans fichiers listés.`);
                 return { status: 'error', links: [] };
            }
             if (!torrentInfo.links || torrentInfo.links.length === 0) {
                 console.warn(`[REALDEBRID STATUS] Torrent ID ${torrentId} complété mais sans liens disponibles (peut nécessiter une sélection manuelle?).`);
                 // Tenter de sélectionner les fichiers si ce n'est pas déjà fait
                 if (torrentInfo.files.some(f => f.selected === 0)) {
                    try {
                        console.log(`[REALDEBRID STATUS] Tentative de sélection des fichiers pour ${torrentId}...`);
                        await this.selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName);
                        // Re-vérifier après sélection
                         const updatedInfo = await this.getTorrentInfo(torrentId);
                         if (!updatedInfo.links || updatedInfo.links.length === 0) {
                             console.error(`[REALDEBRID STATUS] Liens toujours indisponibles après sélection pour ${torrentId}.`);
                             return { status: 'error', links: [] };
                         }
                         torrentInfo.links = updatedInfo.links; // Mettre à jour les liens
                    } catch (selectError) {
                         console.error(`[REALDEBRID STATUS] Erreur lors de la tentative de sélection des fichiers pour ${torrentId}:`, selectError);
                         return { status: 'error', links: [] };
                    }
                 } else {
                    console.error(`[REALDEBRID STATUS] Torrent ID ${torrentId} complété, fichiers sélectionnés mais aucun lien retourné par l'API.`);
                    return { status: 'error', links: [] };
                 }
            }


            // Enrichir les fichiers pour la sélection
            const enrichedFiles = torrentInfo.files.map(file => ({
                ...file,
                extension: getFileExtension(file.path || file.name || ''),
                isVideo: isVideoFile(file.path || file.name || ''),
                // Ajouter l'URL du lien correspondant si disponible (pour la sélection)
                url: torrentInfo.links[torrentInfo.files.findIndex(f => f.id === file.id)] || null
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episodeNumber, episodeName, {
                fileIndex,
                streamType
            });

            if (!bestFile) {
                console.error(`[REALDEBRID STATUS] No matching file found for episode ${episodeNumber} in torrent ${torrentId}`);
                return { status: 'error', links: [] };
            }

            // Ensure the best file is explicitly selected
            if (bestFile.selected !== 1) {
                console.log(`[REALDEBRID STATUS] Explicitly selecting file ID ${bestFile.id} for torrent ${torrentId}`);
                await this.selectFiles(torrentId, bestFile.id, null, episode, streamType, episodeName);
                torrentInfo = await this.getTorrentInfo(torrentId); // Refresh info
                enrichedFiles = torrentInfo.files.map(file => ({
                    ...file,
                    extension: getFileExtension(file.path || file.name || ''),
                    isVideo: isVideoFile(file.path || file.name || '')
                }));
            }

            // Find the link that matches our selected file's name
            const selectedLink = torrentInfo.links.find(link => {
                const linkName = link.split('/').pop().toLowerCase();
                const fileName = bestFile.path.split('/').pop().toLowerCase();
                return linkName.includes(fileName) || fileName.includes(linkName);
            });

            if (!selectedLink) {
                console.error(`[REALDEBRID STATUS] Could not find matching link for selected file in torrent ${torrentId}`);
                return { status: 'error', links: [] };
            }

            console.log(`[REALDEBRID STATUS] Found direct stream link for episode ${episodeNumber}`);

            // Use the most reliable link source (either from direct match or enriched file)
            const finalLink = selectedLink || bestFile.url;
            
            if (!finalLink) {
                 console.error(`[REALDEBRID STATUS] No valid link found for selected file ${bestFile.path} in torrent ${torrentId}`);
                 return { status: 'error', links: [] };
            }

            console.log(`[REALDEBRID STATUS] Selected file: ${bestFile.path}, Final link: ${finalLink}`);

            return {
                status: 'completed',
                links: [{
                    url: finalLink,
                    filename: bestFile.path.split('/').pop(),
                    name: bestFile.path.split('/').pop(),
                    path: bestFile.path,
                    size: bestFile.bytes,
                    extension: getFileExtension(bestFile.path),
                    isVideo: isVideoFile(bestFile.path)
                }]
            };

        } catch (error) {
            console.error(`[REALDEBRID STATUS] Erreur lors de la récupération du statut/liens pour ${magnetLink.substring(0,50)}...:`, error);
            return { status: 'error', links: [] }; // Retourner un statut d'erreur générique
        }
    }
}

module.exports = RealDebrid;