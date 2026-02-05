const { createCanvas } = require('canvas');
const fs = require('fs');

const size = 1024;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Green background (SCWS brand color)
ctx.fillStyle = '#059669';
ctx.fillRect(0, 0, size, size);

// White circle
ctx.beginPath();
ctx.arc(size/2, size/2, size * 0.35, 0, Math.PI * 2);
ctx.fillStyle = 'white';
ctx.fill();

// Add text
ctx.fillStyle = '#059669';
ctx.font = 'bold 200px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('SCWS', size/2, size/2);

// Save
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('icon.png', buffer);
console.log('Icon created: icon.png');
