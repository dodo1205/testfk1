const axios = require('axios');
const DebridService = require('./baseService');
const { selectBestFile, isVideoFile, getFileExtension } = require('../fileUtils');

/**
 * Service de debridage AllDebrid
 */
class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = 'https://api.alldebrid.com/v4';
    }

    /**
     * Vérifie si l'API key est valide
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        try {
            const response = await axios.get(`${this.baseUrl}/user`, {
                params: {
                    agent: 'FKStream',
                    apikey: this.apiKey
                }
            });
            return response.data.status === 'success';
        } catch (error) {
            console.error('Erreur lors de la vérification de l\'API key AllDebrid:', error);
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
     * Vérifie si un magnet est déjà en cache
     * @param {string} infoHash - Hash du torrent
     * @returns {Promise<boolean>} - true si le magnet est en cache
     */
    async checkMagnetStatus(infoHash) {
        try {
            console.log(`[ALLDEBRID] Vérification du statut du magnet avec hash: ${infoHash}`);
            
            // Vérifier si le magnet est en cache en utilisant l'API status
            // Cette approche est plus fiable que l'API instant qui peut retourner 404
            const response = await axios.get(`${this.baseUrl}/magnet/status`, {
                params: {
                    agent: 'FKStream',
                    apikey: this.apiKey,
                    id: infoHash // Essayer d'utiliser le hash comme ID
                }
            });
            
            // Si la requête réussit, le magnet est en cache
            if (response.data.status === 'success') {
                console.log(`[ALLDEBRID] Magnet trouvé en cache`);
                return true;
            }
            
            console.log(`[ALLDEBRID] Magnet pas en cache`);
            return false;
        } catch (error) {
            // Si on obtient une erreur, le magnet n'est probablement pas en cache
            console.log(`[ALLDEBRID] Magnet pas en cache`);
            return false;
        }
    }

    /**
     * Dérestriction d'un lien pour obtenir un lien direct
     * @param {string} link - Lien à dérestreindre
     * @returns {Promise<string>} - Lien direct
     */
    async unrestrictLink(link) {
        try {
            console.log(`[ALLDEBRID] Dérestriction du lien: ${link}`);
            const response = await axios.get(`${this.baseUrl}/link/unlock`, {
                params: {
                    agent: 'FKStream',
                    apikey: this.apiKey,
                    link: link
                }
            });

            if (response.data.status !== 'success') {
                throw new Error('Échec de la dérestriction du lien sur AllDebrid');
            }

            console.log(`[ALLDEBRID] Lien dérestreint: ${response.data.data.link}`);
            return response.data.data.link;
        } catch (error) {
            console.error('Erreur lors de la dérestriction du lien avec AllDebrid:', error);
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
            
            // Vérifier si le magnet est déjà en cache
            const isInstant = await this.checkMagnetStatus(infoHash);
            console.log(`[ALLDEBRID] Magnet ${isInstant ? 'en cache' : 'pas en cache'}`);
            
            // Ajouter le magnet
            console.log(`[ALLDEBRID] Ajout du magnet: ${magnetLink.substring(0, 50)}...`);
            const uploadResponse = await axios.get(`${this.baseUrl}/magnet/upload`, {
                params: {
                    agent: 'FKStream',
                    apikey: this.apiKey,
                    magnets: magnetLink
                }
            });

            if (uploadResponse.data.status !== 'success') {
                throw new Error('Échec de l\'upload du magnet sur AllDebrid');
            }

            const magnetId = uploadResponse.data.data.magnets[0].id;
            console.log(`[ALLDEBRID] Magnet ajouté avec ID: ${magnetId}`);

            // Attendre que le magnet soit prêt (avec timeout)
            let magnetInfo;
            let isReady = false;
            const startTime = Date.now();
            const timeout = 30000; // 30 secondes
            
            while (!isReady && Date.now() - startTime < timeout) {
                const statusResponse = await axios.get(`${this.baseUrl}/magnet/status`, {
                    params: {
                        agent: 'FKStream',
                        apikey: this.apiKey,
                        id: magnetId
                    }
                });
                
                if (statusResponse.data.status !== 'success') {
                    throw new Error('Échec de la récupération du statut du magnet sur AllDebrid');
                }
                
                magnetInfo = statusResponse.data.data.magnets;
                isReady = magnetInfo.status === 'Ready';
                
                if (!isReady) {
                    console.log(`[ALLDEBRID] Magnet pas encore prêt, statut: ${magnetInfo.status}`);
                    // Attendre 2 secondes avant de vérifier à nouveau
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (!isReady) {
                console.log(`[ALLDEBRID] Timeout atteint, le magnet n'est pas encore prêt`);
                // Retourner un objet spécial pour indiquer que le magnet est en cours de téléchargement
                return {
                    id: magnetId,
                    name: 'Magnet en cours de téléchargement',
                    status: 'downloading',
                    files: []
                };
            }
            
            console.log(`[ALLDEBRID] Magnet prêt avec ID: ${magnetId}`);
            return {
                id: magnetId,
                name: magnetInfo.filename,
                status: magnetInfo.status,
                files: magnetInfo.links
            };
        } catch (error) {
            console.error('Erreur lors du debridage du magnet avec AllDebrid:', error);
            throw error;
        }
    }

    /**
     * Récupérer les liens de téléchargement
     * @param {string} id - ID du magnet débridé
     * @param {number} fileIndex - Index du fichier à sélectionner (optionnel)
     * @param {string} season - Numéro de saison (pour les séries)
     * @param {string} episode - Numéro d'épisode (pour les séries)
     * @param {string} streamType - Type de stream (toujours 'series')
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @returns {Promise<Array>} - Liste des liens de téléchargement
     */
    async getDownloadLinks(id, fileIndex = null, season = null, episode = null, streamType = 'series', episodeName = null) {
        try {
            console.log(`[ALLDEBRID] Récupération des liens de téléchargement pour le magnet ID: ${id}`);
            const response = await axios.get(`${this.baseUrl}/magnet/status`, {
                params: {
                    agent: 'FKStream',
                    apikey: this.apiKey,
                    id: id
                }
            });

            if (response.data.status !== 'success') {
                throw new Error('Échec de la récupération des liens de téléchargement sur AllDebrid');
            }

            // Vérifier si la structure attendue existe
            if (!response.data.data.magnets || !response.data.data.magnets.links) {
                console.error('[ALLDEBRID] Structure de réponse inattendue:', response.data);
                throw new Error('Structure de réponse AllDebrid inattendue');
            }
            
            const allLinks = response.data.data.magnets.links.map(link => ({
                url: link.link,
                filename: link.filename,
                name: link.filename, // Pour compatibilité avec selectBestFile
                path: link.filename, // Pour compatibilité avec selectBestFile
                size: link.size,
                extension: getFileExtension(link.filename),
                isVideo: isVideoFile(link.filename)
            }));
            
            // Sélectionner le fichier approprié
            const selectedFile = this.selectBestFile(allLinks, episode, episodeName, {
                fileIndex,
                streamType
            });
            
            // Si aucun fichier n'est sélectionné, retourner tous les liens
            const links = selectedFile ? [selectedFile] : allLinks;
            
            console.log(`[ALLDEBRID] ${links.length} liens de téléchargement récupérés`);
            return links;
        } catch (error) {
            console.error('Erreur lors de la récupération des liens de téléchargement avec AllDebrid:', error);
            throw error;
        }
    }

    /**
     * Ajoute un lien magnet au service sans attendre la complétion.
     * @param {string} magnetLink - Lien magnet à ajouter
     * @returns {Promise<string|null>} - ID du magnet ajouté ou null si erreur
     */
    async addMagnetOnly(magnetLink) {
        try {
            console.log(`[ALLDEBRID ADDONLY] Ajout du magnet: ${magnetLink.substring(0, 50)}...`);
            const uploadResponse = await axios.get(`${this.baseUrl}/magnet/upload`, {
                params: {
                    agent: 'FKStream',
                    apikey: this.apiKey,
                    magnets: magnetLink // L'API attend 'magnets' même pour un seul
                }
            });

            if (uploadResponse.data.status !== 'success' || !uploadResponse.data.data.magnets || uploadResponse.data.data.magnets.length === 0) {
                 // Gérer le cas où le magnet existe déjà (peut retourner une erreur ou un succès sans ID?)
                 // L'API semble retourner un succès même si déjà présent, avec l'ID existant.
                 if (uploadResponse.data.data && uploadResponse.data.data.magnets && uploadResponse.data.data.magnets[0] && uploadResponse.data.data.magnets[0].id) {
                    const existingId = uploadResponse.data.data.magnets[0].id;
                    console.log(`[ALLDEBRID ADDONLY] Magnet déjà présent ou ajouté avec ID: ${existingId}`);
                    return existingId;
                 }
                 console.error('[ALLDEBRID ADDONLY] Réponse inattendue ou échec de l\'upload:', uploadResponse.data);
                 throw new Error('Échec de l\'upload du magnet sur AllDebrid ou réponse invalide');
            }

            // Récupérer l'ID du magnet ajouté (normalement le premier de la liste)
            const magnetId = uploadResponse.data.data.magnets[0].id;
            console.log(`[ALLDEBRID ADDONLY] Magnet ajouté avec ID: ${magnetId}`);
            return magnetId;

        } catch (error) {
            console.error(`[ALLDEBRID ADDONLY] Erreur lors de l'ajout du magnet:`, error.message);
            // Ne pas propager l'erreur pour ne pas bloquer le flux principal
            return null;
        }
    }

    /**
     * Vérifie l'état d'un torrent et récupère les liens si complété.
     * @param {string} magnetLink - Lien magnet à vérifier (utilisé pour retrouver l'ID si besoin)
     * @param {number|null} fileIndex - Index du fichier spécifique (si connu)
     * @param {string|null} season - Numéro de saison (si series)
     * @param {string|null} episode - Numéro d'épisode (si series)
     * @param {string} streamType - Type de contenu ('series', 'movie')
     * @param {string|null} episodeName - Nom de l'épisode (si series)
     * @returns {Promise<Object|null>} - Objet avec { status: '...', links: [...] } ou null
     */
    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        let magnetId = null;
        try {
            // 1. Essayer de retrouver l'ID du magnet (l'API status le requiert)
            // On utilise /magnet/upload qui retourne l'ID même si déjà présent
            console.log(`[ALLDEBRID STATUS] Recherche de l'ID pour magnet: ${magnetLink.substring(0, 50)}...`);
            const uploadResponse = await axios.get(`${this.baseUrl}/magnet/upload`, {
                params: { agent: 'FKStream', apikey: this.apiKey, magnets: magnetLink }
            });

            if (uploadResponse.data.status !== 'success' || !uploadResponse.data.data.magnets || uploadResponse.data.data.magnets.length === 0) {
                console.error('[ALLDEBRID STATUS] Impossible de retrouver l\'ID du magnet via /upload:', uploadResponse.data);
                return { status: 'error', links: [] }; // Erreur si on ne trouve pas l'ID
            }
            magnetId = uploadResponse.data.data.magnets[0].id;
            console.log(`[ALLDEBRID STATUS] ID du magnet trouvé/confirmé: ${magnetId}`);

            // 2. Récupérer le statut du magnet avec son ID
            const statusResponse = await axios.get(`${this.baseUrl}/magnet/status`, {
                params: { agent: 'FKStream', apikey: this.apiKey, id: magnetId }
            });

            if (statusResponse.data.status !== 'success') {
                console.error(`[ALLDEBRID STATUS] Échec de la récupération du statut pour ID ${magnetId}:`, statusResponse.data);
                return { status: 'error', links: [] };
            }

            const magnetInfo = statusResponse.data.data.magnets;

            // 3. Mapper le statut AllDebrid à nos statuts standards
            const statusMap = {
                'Queued': 'downloading',
                'Downloading': 'downloading',
                'Uploading': 'downloading', // Considéré comme en cours
                'Ready': 'completed',
                'Error': 'error',
                'File Error': 'error'
                // Ajouter d'autres statuts si nécessaire
            };
            const currentStatus = statusMap[magnetInfo.status] || 'error'; // Défaut à 'error'

            if (currentStatus !== 'completed') {
                console.log(`[ALLDEBRID STATUS] Magnet ID ${magnetId} non complété. Statut AD: ${magnetInfo.status} -> Statut Mappé: ${currentStatus}`);
                return { status: currentStatus, links: [] };
            }

            // 4. Si complété, sélectionner le fichier et extraire le lien
            console.log(`[ALLDEBRID STATUS] Magnet ID ${magnetId} complété. Sélection du fichier...`);

            if (!magnetInfo.links || magnetInfo.links.length === 0) {
                console.error(`[ALLDEBRID STATUS] Magnet ID ${magnetId} complété mais sans liens listés.`);
                return { status: 'error', links: [] };
            }

            // Enrichir les fichiers pour la sélection
            const enrichedFiles = magnetInfo.links.map(link => ({
                ...link, // Contient déjà filename, size
                url: link.link, // L'URL à dérestreindre potentiellement
                name: link.filename,
                path: link.filename,
                extension: getFileExtension(link.filename),
                isVideo: isVideoFile(link.filename)
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, {
                fileIndex,
                streamType
            });

            if (!bestFile) {
                console.error(`[ALLDEBRID STATUS] Aucun fichier correspondant trouvé pour l'épisode ${episode} dans le magnet ${magnetId}`);
                return { status: 'error', links: [] };
            }

            console.log(`[ALLDEBRID STATUS] Fichier sélectionné: ${bestFile.filename}, Lien à dérestreindre: ${bestFile.url}`);

            // Retourner le lien sélectionné (qui sera dérestreint plus tard par debridTorrent dans index.js)
            return {
                status: 'completed',
                links: [{
                    url: bestFile.url, // C'est le lien qui nécessite dérestriction
                    filename: bestFile.filename
                }]
            };

        } catch (error) {
            console.error(`[ALLDEBRID STATUS] Erreur lors de la récupération du statut/liens pour magnet ${magnetId || magnetLink.substring(0,50)}...:`, error.message);
             // Si l'erreur vient de axios et contient une réponse, l'afficher
             if (error.response) {
                console.error("Response data:", error.response.data);
                console.error("Response status:", error.response.status);
            }
            return { status: 'error', links: [] }; // Retourner un statut d'erreur générique
        }
    }
}

module.exports = AllDebrid;