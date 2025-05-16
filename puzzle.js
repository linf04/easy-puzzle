const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const app = express();

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir });

// 确保输出目录存在
const outputDir = path.join(__dirname, 'puzzle_pieces');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const multerMerge = multer({ dest: uploadDir });

// 提供静态文件
app.use(express.static(__dirname));
app.use('/puzzle_pieces', express.static('puzzle_pieces'));

// 处理文件上传和生成拼图
app.post('/generate', upload.single('image'), async (req, res) => {
  try {
    console.log('收到图片上传请求');

    if (!req.file) {
      console.error('没有收到文件');
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const numPieces = parseInt(req.body.numPieces) || 2;
    if (numPieces < 2 || numPieces > 9) {
      return res.status(400).json({ error: '碎片数量必须在5-9之间' });
    }

    console.log('开始处理图片:', req.file.path);
    let imagePath = req.file.path;
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    console.log('图片信息:', metadata);

    // 计算碎片大小（图片宽度的1/100）
    const blockSize = Math.floor(metadata.width / 100);
    console.log(`碎片大小: ${blockSize}x${blockSize} 像素`);

    // 将图片分成小块
    const blocksX = Math.ceil(metadata.width / blockSize);
    const blocksY = Math.ceil(metadata.height / blockSize);
    const totalBlocks = blocksX * blocksY;

    console.log(`将图片分成 ${blocksX}x${blocksY} 个小块，总共 ${totalBlocks} 个碎片，每个碎片 ${blockSize}x${blockSize} 像素`);


    // 为每个输出图片创建缓冲区
    const outputBuffers = Array(numPieces).fill().map(() =>
      Buffer.alloc(metadata.width * metadata.height * 4, 255)
    );

    // 随机分配每个块到输出图片
    for (let blockY = 0; blockY < blocksY; blockY++) {
      for (let blockX = 0; blockX < blocksX; blockX++) {
        // 随机选择一个输出图片
        const outputIndex = Math.floor(Math.random() * numPieces);

        // 提取当前块
        const block = await image
          .clone()
          .extract({
            left: blockX * blockSize,
            top: blockY * blockSize,
            width: Math.min(blockSize, metadata.width - blockX * blockSize),
            height: Math.min(blockSize, metadata.height - blockY * blockSize)
          })
          .raw()
          .toBuffer();

        // 将块复制到选定的输出图片
        const outputBuffer = outputBuffers[outputIndex];
        for (let y = 0; y < blockSize && (blockY * blockSize + y) < metadata.height; y++) {
          for (let x = 0; x < blockSize && (blockX * blockSize + x) < metadata.width; x++) {
            const sourceIndex = (y * blockSize + x) * 4;
            const targetIndex = ((blockY * blockSize + y) * metadata.width + (blockX * blockSize + x)) * 4;

            if (sourceIndex < block.length && targetIndex < outputBuffer.length) {
              outputBuffer[targetIndex] = block[sourceIndex];     // R
              outputBuffer[targetIndex + 1] = block[sourceIndex + 1]; // G
              outputBuffer[targetIndex + 2] = block[sourceIndex + 2]; // B
              outputBuffer[targetIndex + 3] = block[sourceIndex + 3]; // A
            }
          }
        }
      }
    }

    // 保存所有输出图片
    const pieces = [];
    for (let i = 0; i < numPieces; i++) {
      const piecePath = path.join(outputDir, `piece_${i}.png`);
      await sharp(outputBuffers[i], {
        raw: {
          width: metadata.width,
          height: metadata.height,
          channels: 4
        }
      })
        .png()
        .toFile(piecePath);

      pieces.push(`/puzzle_pieces/piece_${i}.png`);
      console.log(`保存碎片到: ${piecePath}`);
    }

    // 清理上传的文件
    fs.unlinkSync(imagePath);
    console.log('处理完成，返回结果');

    res.json({ pieces });
  } catch (error) {
    console.error('详细错误信息:', error);
    res.status(500).json({
      error: '处理图片时出错',
      details: error.message,
      stack: error.stack
    });
  }
});

app.post('/merge', multerMerge.array('images'), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length < 2) {
      return res.status(400).send('请上传至少两张图片');
    }

    // 读取第一张图片作为基础
    let base = sharp(files[0].path).ensureAlpha();
    let { width, height } = await base.metadata();
    let currentBuffer = await base.toBuffer();

    // 依次与每张图片合并
    for (let i = 1; i < files.length; i++) {
      // 读取当前要合并的图片
      let overlay = await sharp(files[i].path)
        .resize(width, height, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .ensureAlpha()
        .toBuffer();

      // 将当前结果和新的图片合并
      currentBuffer = await sharp(currentBuffer)
        .composite([{ input: overlay, blend: 'multiply' }])
        .toBuffer();
    }

    // 输出最终合成结果
    res.set('Content-Type', 'image/png');
    res.send(currentBuffer);

    // 清理临时文件
    files.forEach(f => fs.unlinkSync(f.path));
  } catch (err) {
    res.status(500).send('合并失败: ' + err.message);
  }
});

const PORT = 9999;
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`上传目录: ${uploadDir}`);
  console.log(`输出目录: ${outputDir}`);
}); 