const axios = require('axios');
const DebridService = require('./baseService');
const { selectBestFile, isVideoFile, getFileExtension, filterVideoFiles, sortFilesBySize } = require('../fileUtils');
const FormData = require('form-data');

/**
 * Service de debridage Torbox
 */
class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = 'https://api.torbox.app/v1';
        this.token = apiKey;
    }

    /**
     * Vérifie si l'API key est valide
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/torrents/mylist`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            return response.data && response.data.success === true;
        } catch (error) {
            console.error('Erreur lors de la vérification de l\'API key Torbox:', error);
            return false;
        }
    }

    /**
     * Vérifie si un torrent est déjà en cache
     * @param {string} hash - Hash du torrent
     * @returns {Promise<Object|null>} - Détails du torrent en cache ou null
     */
    async checkCache(hash) {
        try {
            console.log(`[TORBOX] Vérification du cache pour le hash: ${hash}`);
            const response = await axios.get(`${this.baseUrl}/api/torrents/checkcached`, {
                params: {
                    hash: hash
                },
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (!response.data || !response.data.success) {
                console.log(`[TORBOX] Erreur ou torrent non trouvé en cache: ${JSON.stringify(response.data)}`);
                return null;
            }

            // Si aucun résultat dans le cache, retourner null
            if (!response.data.data || !response.data.data.length || response.data.data[0] === false) {
                console.log(`[TORBOX] Torrent non trouvé en cache`);
                return null;
            }

            console.log(`[TORBOX] Torrent trouvé en cache: ${JSON.stringify(response.data.data)}`);
            return response.data.data[0];
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la vérification du cache: ${error.message}`);
            return null;
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
     * Récupère la liste des torrents de l'utilisateur
     * @returns {Promise<Array>} - Liste des torrents
     */
    async getMyTorrents() {
        try {
            console.log(`[TORBOX] Récupération de la liste des torrents`);
            const response = await axios.get(`${this.baseUrl}/api/torrents/mylist`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (!response.data || !response.data.success) {
                console.error(`[TORBOX] Erreur lors de la récupération des torrents: ${JSON.stringify(response.data)}`);
                return [];
            }

            return response.data.data || [];
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la récupération des torrents: ${error.message}`);
            return [];
        }
    }

    /**
     * Recherche un torrent existant par son hash
     * @param {string} infoHash - Hash du torrent à rechercher
     * @returns {Promise<Object|null>} - Informations sur le torrent trouvé ou null
     */
    async findExistingTorrent(infoHash) {
        try {
            console.log(`[TORBOX] Recherche d'un torrent existant avec le hash: ${infoHash}`);
            const torrents = await this.getMyTorrents();

            for (const torrent of torrents) {
                if (torrent.hash && torrent.hash.toLowerCase() === infoHash.toLowerCase()) {
                    console.log(`[TORBOX] Torrent existant trouvé avec ID: ${torrent.id}`);
                    return torrent;
                }
            }

            console.log('[TORBOX] Aucun torrent existant trouvé');
            return null;
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la recherche d'un torrent existant: ${error.message}`);
            return null;
        }
    }

    /**
     * Crée un nouveau torrent
     * @param {string} magnetLink - Lien magnet
     * @returns {Promise<Object>} - Information sur le torrent créé
     */
    async createTorrent(magnetLink) {
        try {
            console.log(`[TORBOX] Création d'un nouveau torrent: ${magnetLink.substring(0, 50)}...`);
            
            // Créer un objet FormData
            const form = new FormData();
            form.append('magnet', magnetLink);
            
            const response = await axios.post(`${this.baseUrl}/api/torrents/createtorrent`, 
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        ...form.getHeaders() // Important pour FormData
                    }
                }
            );
    
            if (!response.data || !response.data.success) {
                throw new Error(`Échec de la création du torrent: ${JSON.stringify(response.data)}`);
            }
    
            console.log(`[TORBOX] Torrent créé avec succès: ${JSON.stringify(response.data.data)}`);
            return response.data.data;
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la création du torrent: ${error.message}`);
            throw error;
        }
    }

    /**
     * Récupère les informations détaillées d'un torrent
     * @param {string} torrentId - ID du torrent
     * @returns {Promise<Object>} - Informations détaillées du torrent
     */
    async getTorrentInfo(torrentId) {
        try {
            console.log(`[TORBOX] Récupération des informations du torrent ID: ${torrentId}`);
            const response = await axios.get(`${this.baseUrl}/api/torrents/mylist`, {
                params: {
                    id: torrentId,
                    bypass_cache: true
                },
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (!response.data || !response.data.success) {
                throw new Error(`Échec de la récupération des informations du torrent: ${JSON.stringify(response.data)}`);
            }

            console.log(`[TORBOX] Informations du torrent récupérées: ${JSON.stringify(response.data.data)}`);
            return response.data.data;
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la récupération des informations du torrent: ${error.message}`);
            throw error;
        }
    }

    /**
     * Contrôle un torrent (démarrer, arrêter, supprimer)
     * @param {string} torrentId - ID du torrent
     * @param {string} operation - Opération à effectuer (start, stop, delete)
     * @returns {Promise<boolean>} - Succès de l'opération
     */
    async controlTorrent(torrentId, operation) {
        try {
            console.log(`[TORBOX] Contrôle du torrent ID: ${torrentId}, opération: ${operation}`);
            const response = await axios.post(`${this.baseUrl}/api/torrents/controltorrent`, {
                torrent_id: torrentId,
                operation: operation
            }, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.data || !response.data.success) {
                throw new Error(`Échec de l'opération ${operation} sur le torrent: ${JSON.stringify(response.data)}`);
            }

            console.log(`[TORBOX] Opération ${operation} réussie sur le torrent ID: ${torrentId}`);
            return true;
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de l'opération ${operation} sur le torrent: ${error.message}`);
            return false;
        }
    }

    /**
     * Sélectionne le fichier approprié en fonction du type de stream
     * @param {Object} torrentInfo - Informations sur le torrent
     * @param {string} streamType - Type de stream (series par défaut)
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @returns {Object|null} - Fichier sélectionné ou null
     * @deprecated Cette méthode est conservée pour compatibilité mais utilise maintenant la méthode de la classe de base
     */
    selectBestFile(torrentInfo, streamType, fileIndex, season, episode, episodeName = null) {
        // Enrichir les fichiers avec des informations supplémentaires
        const enrichedFiles = torrentInfo.files.map(file => ({
            ...file,
            extension: getFileExtension(file.name || file.path || ''),
            isVideo: isVideoFile(file.name || file.path || '')
        }));
        
        // Utiliser la méthode de la classe de base
        return super.selectBestFile(enrichedFiles, episode, episodeName, {
            fileIndex,
            streamType
        });
    }

    /**
     * Génère un lien de téléchargement pour un fichier spécifique
     * @param {string} torrentId - ID du torrent
     * @param {string} fileId - ID du fichier
     * @returns {Promise<string>} - URL de téléchargement
     */
    async requestDownloadLink(torrentId, fileId) {
        try {
            console.log(`[TORBOX] Demande de lien de téléchargement pour le torrent ID: ${torrentId}, fichier ID: ${fileId}`);
            const response = await axios.get(`${this.baseUrl}/api/torrents/requestdl`, {
                params: {
                    token: this.token, // Ajouter le token comme paramètre (comme fait dans AllDebrid)
                    torrent_id: torrentId,
                    file_id: fileId,
                    zip_link: false // Paramètre optionnel mentionné dans certains exemples TorBox
                },
                headers: {
                    'Authorization': `Bearer ${this.token}` // Garder aussi l'en-tête d'autorisation
                }
            });
    
            if (!response.data || !response.data.success) {
                throw new Error(`Échec de la génération du lien de téléchargement: ${JSON.stringify(response.data)}`);
            }
    
            // Vérifier le format de réponse et s'adapter
            const downloadLink = response.data.data;
            console.log(`[TORBOX] Lien de téléchargement généré: ${downloadLink}`);
            
            return downloadLink;
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la génération du lien de téléchargement: ${error.message}`);
            throw error;
        }
    }

    /**
     * Attendre qu'un torrent soit prêt
     * @param {string} torrentId - ID du torrent
     * @param {number} timeout - Timeout en ms
     * @param {number} interval - Intervalle de vérification en ms
     * @returns {Promise<Object|null>} - Informations du torrent ou null si timeout
     */
    async waitForTorrentToBeReady(torrentId, timeout = 30000, interval = 2000) {
        const startTime = Date.now();
        console.log(`[TORBOX] Attente que le torrent ID: ${torrentId} soit prêt (timeout: ${timeout}ms)`);
        
        while (Date.now() - startTime < timeout) {
            try {
                const torrentInfo = await this.getTorrentInfo(torrentId);
                
                // Vérifier si le torrent a des fichiers (il est prêt)
                if (torrentInfo.files && torrentInfo.files.length > 0) {
                    console.log(`[TORBOX] Torrent ID: ${torrentId} est prêt avec ${torrentInfo.files.length} fichiers`);
                    return torrentInfo;
                }
                
                console.log(`[TORBOX] Torrent ID: ${torrentId} n'est pas encore prêt, attente...`);
                // Attendre l'intervalle spécifié
                await new Promise(resolve => setTimeout(resolve, interval));
            } catch (error) {
                console.error(`[TORBOX] Erreur lors de l'attente du torrent: ${error.message}`);
                // Continuer d'attendre même en cas d'erreur
            }
        }
        
        console.log(`[TORBOX] Timeout atteint pour le torrent ID: ${torrentId}`);
        return null;
    }

    /**
     * Débrider un lien magnet
     * @param {string} magnetLink - Lien magnet à débrider
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (series par défaut)
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
            
            console.log(`[TORBOX] Traitement du magnet avec hash: ${infoHash}`);
            
            // 1. Vérifier si le torrent est en cache
            const cachedTorrent = await this.checkCache(infoHash);
            
            if (cachedTorrent) {
                console.log(`[TORBOX] Torrent trouvé en cache, utilisation directe`);
                return {
                    id: cachedTorrent.id,
                    hash: infoHash,
                    name: cachedTorrent.name || 'Torrent en cache',
                    status: 'cached',
                    files: cachedTorrent.files || []
                };
            }
            
            // 2. Vérifier si le torrent existe déjà dans la liste de l'utilisateur
            const existingTorrent = await this.findExistingTorrent(infoHash);
            
            if (existingTorrent) {
                console.log(`[TORBOX] Torrent existant trouvé avec ID: ${existingTorrent.id}`);
                return {
                    id: existingTorrent.id,
                    hash: infoHash,
                    name: existingTorrent.name,
                    status: existingTorrent.status,
                    files: existingTorrent.files || []
                };
            }
            
            // 3. Créer un nouveau torrent
            console.log(`[TORBOX] Ajout d'un nouveau torrent`);
            const newTorrent = await this.createTorrent(magnetLink);
            
            if (!newTorrent || !newTorrent.torrent_id) {
                throw new Error('Échec de la création du torrent');
            }
            
            const torrentId = newTorrent.torrent_id;
            console.log(`[TORBOX] Nouveau torrent créé avec ID: ${torrentId}`);
            
            // 4. Attendre que le torrent soit prêt (avec timeout)
            const readyTorrent = await this.waitForTorrentToBeReady(torrentId);
            
            if (!readyTorrent) {
                console.log(`[TORBOX] Le torrent n'est pas encore prêt, retourne un statut en téléchargement`);
                return {
                    id: torrentId,
                    hash: infoHash,
                    name: 'Torrent en cours de téléchargement',
                    status: 'downloading',
                    files: []
                };
            }
            
            return {
                id: torrentId,
                hash: infoHash,
                name: readyTorrent.name,
                status: readyTorrent.status,
                files: readyTorrent.files || []
            };
        } catch (error) {
            console.error(`[TORBOX] Erreur lors du débridage du magnet: ${error.message}`);
            throw error;
        }
    }

    /**
     * Récupérer les liens de téléchargement
     * @param {string} id - ID du torrent débridé
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (series par défaut)
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @returns {Promise<Array>} - Liste des liens de téléchargement
     */
    async getDownloadLinks(id, fileIndex = null, season = null, episode = null, streamType = 'series', episodeName = null) {
        try {
            console.log(`[TORBOX] Récupération des liens de téléchargement pour le torrent ID: ${id}`);
            
            // 1. Récupérer les informations détaillées du torrent
            const torrentInfo = await this.getTorrentInfo(id);
            
            if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                console.error(`[TORBOX] Aucun fichier trouvé pour le torrent ID: ${id}`);
                return [];
            }
            
            // 2. Sélectionner le meilleur fichier en utilisant la fonction unifiée
            const selectedFile = this.selectBestFile(torrentInfo, streamType, fileIndex, season, episode, episodeName);
            
            if (!selectedFile) {
                console.error(`[TORBOX] Aucun fichier approprié trouvé pour le torrent ID: ${id}`);
                return [];
            }
            
            console.log(`[TORBOX] Fichier sélectionné: ${selectedFile.name} (ID: ${selectedFile.id})`);
            
            // 3. Générer le lien de téléchargement
            const downloadLink = await this.requestDownloadLink(id, selectedFile.id);
            
            if (!downloadLink) {
                console.error(`[TORBOX] Échec de la génération du lien de téléchargement`);
                return [];
            }
            
            return [{
                url: downloadLink,
                filename: selectedFile.name,
                size: selectedFile.size
            }];
        } catch (error) {
            console.error(`[TORBOX] Erreur lors de la récupération des liens de téléchargement: ${error.message}`);
            return [];
        }
    }

    /**
     * Ajoute un lien magnet au service sans attendre la complétion.
     * @param {string} magnetLink - Lien magnet à ajouter
     * @returns {Promise<string|null>} - ID du torrent ajouté/trouvé ou null si erreur
     */
    async addMagnetOnly(magnetLink) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) {
                throw new Error('Hash non trouvé dans le lien magnet pour addMagnetOnly');
            }

            console.log(`[TORBOX ADDONLY] Traitement du magnet avec hash: ${infoHash}`);

            // 1. Vérifier si le torrent existe déjà dans la liste de l'utilisateur
            const existingTorrent = await this.findExistingTorrent(infoHash);

            if (existingTorrent) {
                console.log(`[TORBOX ADDONLY] Torrent existant trouvé avec ID: ${existingTorrent.id}. Ne rien faire.`);
                // Optionnel: Démarrer le torrent s'il est arrêté?
                // await this.controlTorrent(existingTorrent.id, 'start');
                return existingTorrent.id; // Retourner l'ID existant
            }

            // 2. Créer un nouveau torrent s'il n'existe pas
            console.log(`[TORBOX ADDONLY] Ajout d'un nouveau torrent`);
            const newTorrent = await this.createTorrent(magnetLink);

            if (!newTorrent || !newTorrent.torrent_id) {
                console.error('[TORBOX ADDONLY] Échec de la création du torrent ou réponse invalide.');
                return null; // Échec de la création
            }

            const torrentId = newTorrent.torrent_id;
            console.log(`[TORBOX ADDONLY] Nouveau torrent ajouté avec ID: ${torrentId}`);
            return torrentId; // Retourner le nouvel ID

        } catch (error) {
            console.error(`[TORBOX ADDONLY] Erreur lors de l'ajout du magnet: ${error.message}`);
            return null; // Retourner null en cas d'erreur
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
    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        let torrentId = null;
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) {
                throw new Error('Hash non trouvé dans le lien magnet pour getTorrentStatusAndLinks');
            }

            // 1. Trouver l'ID du torrent correspondant au hash
            console.log(`[TORBOX STATUS] Recherche du torrent avec hash: ${infoHash}`);
            const existingTorrent = await this.findExistingTorrent(infoHash);

            if (!existingTorrent) {
                console.log(`[TORBOX STATUS] Aucun torrent trouvé avec le hash: ${infoHash}. Il faut l'ajouter d'abord.`);
                // Le torrent doit être ajouté via addMagnetOnly avant que cette fonction soit appelée.
                return { status: 'not_found', links: [] };
            }
            torrentId = existingTorrent.id;
            console.log(`[TORBOX STATUS] Torrent trouvé avec ID: ${torrentId}`);

            // 2. Récupérer les informations détaillées (qui incluent les fichiers si prêt)
            const torrentInfo = await this.getTorrentInfo(torrentId);

            // 3. Vérifier le statut basé sur la présence de fichiers
            // L'API Torbox ne semble pas avoir de statut explicite 'completed'.
            // On considère 'completed' si la liste `files` existe et n'est pas vide.
            const isCompleted = torrentInfo && torrentInfo.files && torrentInfo.files.length > 0;
            const currentStatus = isCompleted ? 'completed' : 'downloading'; // Simplification: soit prêt, soit en cours

            if (currentStatus !== 'completed') {
                console.log(`[TORBOX STATUS] Torrent ID ${torrentId} non complété (pas de fichiers listés). Statut: ${currentStatus}`);
                return { status: currentStatus, links: [] };
            }

            // 4. Si complété, sélectionner le fichier et générer le lien
            console.log(`[TORBOX STATUS] Torrent ID ${torrentId} complété. Sélection du fichier...`);

            // Enrichir les fichiers pour la sélection (nécessaire pour selectBestFile)
             const enrichedFiles = torrentInfo.files.map(file => ({
                ...file, // Contient id, name, size
                url: null, // Pas d'URL directe ici, sera générée
                path: file.name, // Utiliser name comme path pour la sélection
                extension: getFileExtension(file.name),
                isVideo: isVideoFile(file.name)
            }));

            const bestFile = super.selectBestFile(enrichedFiles, episode, episodeName, { // Utiliser super pour appeler la méthode de base
                fileIndex,
                streamType
            });


            if (!bestFile) {
                console.error(`[TORBOX STATUS] Aucun fichier correspondant trouvé pour l'épisode ${episode} dans le torrent ${torrentId}`);
                return { status: 'error', links: [] }; // Ou 'no_file_found'
            }

            console.log(`[TORBOX STATUS] Fichier sélectionné: ${bestFile.name} (ID: ${bestFile.id})`);

            // 5. Générer le lien de téléchargement pour le fichier sélectionné
            const downloadLink = await this.requestDownloadLink(torrentId, bestFile.id);

            if (!downloadLink) {
                console.error(`[TORBOX STATUS] Échec de la génération du lien de téléchargement pour fichier ${bestFile.id}`);
                return { status: 'error', links: [] };
            }

            console.log(`[TORBOX STATUS] Lien de téléchargement généré: ${downloadLink}`);

            return {
                status: 'completed',
                links: [{
                    url: downloadLink, // Torbox fournit un lien direct
                    filename: bestFile.name
                }]
            };

        } catch (error) {
            console.error(`[TORBOX STATUS] Erreur lors de la récupération du statut/liens pour torrent ${torrentId || infoHash}:`, error.message);
            return { status: 'error', links: [] }; // Retourner un statut d'erreur générique
        }
    }
}

module.exports = Torbox;