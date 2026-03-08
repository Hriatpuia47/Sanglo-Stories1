const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// simple HTTP Basic auth for admin routes
// set ADMIN_USER and ADMIN_PASS in your environment to customize
// defaults are 'admin' / 'password' which you should change before deployment.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) {
        res.set('WWW-Authenticate', 'Basic');
        return res.status(401).send('Authentication required.');
    }
    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Basic') {
        res.set('WWW-Authenticate', 'Basic');
        return res.status(401).send('Invalid authentication format.');
    }
    const credentials = Buffer.from(parts[1], 'base64').toString().split(':');
    const [user, pass] = credentials;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic');
    return res.status(401).send('Access denied.');
}

// Middleware
app.use(cors());
app.use(bodyParser.json());

// protect direct access to admin.html (static middleware runs later)
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.use(express.static(__dirname));


// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const STORIES_FILE = path.join(DATA_DIR, 'stories.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data files if they don't exist
if (!fs.existsSync(STORIES_FILE)) {
    fs.writeFileSync(STORIES_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
}

// Helper function to read data
function readData(file) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
        return [];
    }
}

// Helper function to write data
function writeData(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${file}:`, error);
        return false;
    }
}

// ==================== STORIES API ====================

// GET all stories
app.get('/api/stories', (req, res) => {
    const stories = readData(STORIES_FILE);
    res.json(stories);
});

// GET single story by ID
app.get('/api/stories/:id', (req, res) => {
    const stories = readData(STORIES_FILE);
    const story = stories.find(s => s.id === req.params.id);
    if (!story) {
        return res.status(404).json({ error: 'Story not found' });
    }
    res.json(story);
});

// ==================== MESSAGES API ====================

// GET all messages
app.get('/api/messages', (req, res) => {
    const messages = readData(MESSAGES_FILE);
    res.json(messages);
});

// POST new message (contact form)
app.post('/api/messages', (req, res) => {
    const messages = readData(MESSAGES_FILE);
    const newMessage = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString()
    };
    messages.unshift(newMessage);
    
    if (writeData(MESSAGES_FILE, messages)) {
        res.status(201).json(newMessage);
    } else {
        res.status(500).json({ error: 'Failed to save message' });
    }
});

// ==================== LIKES & COMMENTS API ====================

// POST like a story (public)
app.post('/api/stories/:id/like', (req, res) => {
    const stories = readData(STORIES_FILE);
    const index = stories.findIndex(s => s.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Story not found' });
    }
    
    stories[index].likes = (stories[index].likes || 0) + 1;
    
    if (writeData(STORIES_FILE, stories)) {
        res.json({ likes: stories[index].likes });
    } else {
        res.status(500).json({ error: 'Failed to like story' });
    }
});

// POST add comment to story (public)
app.post('/api/stories/:id/comments', (req, res) => {
    const stories = readData(STORIES_FILE);
    const index = stories.findIndex(s => s.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Story not found' });
    }
    
    const newComment = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString()
    };
    
    if (!stories[index].comments) {
        stories[index].comments = [];
    }
    stories[index].comments.unshift(newComment);
    
    if (writeData(STORIES_FILE, stories)) {
        res.status(201).json(newComment);
    } else {
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// ==================== ADMIN ROUTES (protected) ====================

// file upload (admin)
const multer = require('multer');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// POST upload image
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
});

// GET all stories (admin view – protected)
app.get('/api/stories', (req, res, next) => {
    // allow public GET but protect write methods
    if (req.method !== 'GET') return next();
    const stories = readData(STORIES_FILE);
    res.json(stories);
});

// POST new story (admin)
app.post('/api/stories', requireAuth, upload.single('image'), (req, res) => {
    const stories = readData(STORIES_FILE);
    
    // Handle image upload or URL
    let imageUrl = req.body.imageUrl;
    if (req.file) {
        imageUrl = `/uploads/${req.file.filename}`;
    }
    
    const newStory = {
        id: Date.now().toString(),
        title: req.body.title,
        category: req.body.category,
        author: req.body.author,
        readTime: parseInt(req.body.readTime),
        content: req.body.content,
        imageUrl: imageUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        likes: 0,
        comments: []
    };
    
    // add to array and persist
    stories.unshift(newStory);

    if (writeData(STORIES_FILE, stories)) {
        res.status(201).json(newStory);
    } else {
        res.status(500).json({ error: 'Failed to save story' });
    }
});

// PUT update story (admin)
app.put('/api/stories/:id', requireAuth, upload.single('image'), (req, res) => {
    const stories = readData(STORIES_FILE);
    const index = stories.findIndex(s => s.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Story not found' });
    }
    
    // Handle image upload or URL
    let imageUrl = req.body.imageUrl || stories[index].imageUrl;
    if (req.file) {
        imageUrl = `/uploads/${req.file.filename}`;
    }
    
    stories[index] = {
        ...stories[index],
        title: req.body.title || stories[index].title,
        category: req.body.category || stories[index].category,
        author: req.body.author || stories[index].author,
        readTime: req.body.readTime ? parseInt(req.body.readTime) : stories[index].readTime,
        content: req.body.content || stories[index].content,
        imageUrl: imageUrl,
    };

    if (writeData(STORIES_FILE, stories)) {
        res.json(stories[index]);
    } else {
        res.status(500).json({ error: 'Failed to update story' });
    }
});

// DELETE story (admin)
app.delete('/api/stories/:id', requireAuth, (req, res) => {
    const stories = readData(STORIES_FILE);
    const index = stories.findIndex(s => s.id === req.params.id);

    if (index === -1) {
        return res.status(404).json({ error: 'Story not found' });
    }

    const deletedStory = stories.splice(index, 1)[0];

    if (writeData(STORIES_FILE, stories)) {
        res.json(deletedStory);
    } else {
        res.status(500).json({ error: 'Failed to delete story' });
    }
});

// GET all messages (public and admin; admin will authenticate when using UI)
app.get('/api/messages', (req, res) => {
    const messages = readData(MESSAGES_FILE);
    res.json(messages);
});

// DELETE message (admin)
app.delete('/api/messages/:id', requireAuth, (req, res) => {
    const messages = readData(MESSAGES_FILE);
    const index = messages.findIndex(m => m.id === req.params.id);

    if (index === -1) {
        return res.status(404).json({ error: 'Message not found' });
    }

    const deletedMessage = messages.splice(index, 1)[0];

    if (writeData(MESSAGES_FILE, messages)) {
        res.json(deletedMessage);
    } else {
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// GET dashboard stats (admin)
app.get('/api/stats', requireAuth, (req, res) => {
    const stories = readData(STORIES_FILE);
    const messages = readData(MESSAGES_FILE);
    
    // Calculate total likes and comments from stories
    let totalLikes = 0;
    let totalComments = 0;
    stories.forEach(story => {
        totalLikes += story.likes || 0;
        totalComments += story.comments ? story.comments.length : 0;
    });
    
    res.json({
        totalStories: stories.length,
        totalLikes,
        totalComments,
        totalMessages: messages.length
    });
});

// serve admin page with auth
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

