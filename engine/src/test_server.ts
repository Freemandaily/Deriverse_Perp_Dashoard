import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Hello World'));
app.listen(8081, () => console.log('Simple server on 8081'));
