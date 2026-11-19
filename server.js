import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MOCK = process.env.MOCK === '1';

const ATURAN = [
  'Kamu asisten informasi PPDB SMKS Muhammadiyah 1 Kota Sukabumi.',
  'Jawab hanya berdasarkan KONTEKS RESMI di bawah.',
  'Jika informasi tidak ada di konteks, katakan belum tersedia dan arahkan pengguna menghubungi panitia PPDB.',
  'Jangan mengarang tanggal, biaya, atau syarat.',
  'Jangan meminta atau menyimpan data pribadi (NIK, kata sandi, foto dokumen).',
  'Jawab singkat dan ramah dalam bahasa Indonesia.',
].join(' ');

const ai = MOCK ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const FAQ = [
  { title: 'Jurusan', text: 'Program keahlian: Pengembangan Perangkat Lunak dan Gim (PPLG). [lengkapi dengan data resmi]' },
  { title: 'Syarat dan berkas', text: '[Syarat dan berkas diisi panitia]' },
  { title: 'Jadwal pendaftaran', text: '[Jadwal diisi panitia]' },
  { title: 'Biaya', text: '[Biaya diisi panitia]' },
  { title: 'Kontak panitia', text: '[Nomor dan alamat diisi panitia]' },
];

async function retrieve(pertanyaan) {
  const kata = pertanyaan.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return FAQ.map((f) => ({
    ...f,
    score: kata.filter((k) => `${f.title} ${f.text}`.toLowerCase().includes(k)).length,
  }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function bersihkanRiwayat(history) {
  const hasil = (Array.isArray(history) ? history : [])
    .slice(-10)
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text.slice(0, 1000) }],
    }));
  while (hasil.length && hasil[0].role !== 'user') hasil.shift();
  return hasil;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, model: MODEL, mock: MOCK }));

app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim() || message.length > 500) {
    return res.status(400).json({ error: 'Pesan harus berupa teks 1 sampai 500 karakter' });
  }

  try {
    const konteks = await retrieve(message);
    const escalate = konteks.length === 0;

    if (MOCK) {
      return res.json({ reply: `(mode contoh) Kamu bertanya: ${message}`, escalate, sources: [] });
    }

    const teksKonteks = konteks.map((k, i) => `[${i + 1}] ${k.title}\n${k.text}`).join('\n\n');
    const contents = [
      ...bersihkanRiwayat(history),
      { role: 'user', parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: `${ATURAN}\n\nKONTEKS RESMI:\n${teksKonteks || '(tidak ada konteks yang cocok)'}`,
      },
    });

    res.json({
      reply: response.text ?? 'Maaf, jawaban tidak tersedia. Silakan hubungi panitia PPDB.',
      escalate,
      sources: konteks.map((k) => ({ title: k.title, score: k.score })),
    });
  } catch (e) {
    console.error('Gagal memanggil model:', e.message);
    res.status(500).json({ error: 'Layanan sedang bermasalah, coba lagi nanti' });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`Server berjalan di port ${PORT} (model ${MODEL}, mock ${MOCK})`),
  );
}

export default app;
