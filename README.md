# Pansus

Pantau Survei dan Sensus adalah aplikasi pilot BPS Sumatera Barat untuk menyiapkan, memeriksa, dan menerbitkan laporan wilayah. Portal pembaca dan Studio menggunakan React/Vite, API menggunakan NestJS, dan impor serta ekspor dijalankan sebagai pekerjaan yang bisa dibuka kembali.

## Jalankan lokal

Gunakan Node.js 24 LTS atau versi yang didukung Vite.

```powershell
npm ci
npm run dev
```

Buka [portal lokal](http://127.0.0.1:5173/). Halaman awal menampilkan PES sintetis. Galeri menyediakan dua template, dua hari data, dan unduhan berkas contoh.

| Akun lokal bawaan | Peran |
|---|---|
| `admin@example.test` | Buat draf, terbitkan, atur akses, dan tutup kegiatan |
| `operator@example.test` | Impor pada dashboard setelah diberi penugasan |
| `reader@example.test` | Buka dashboard dengan undangan aktif pada alamat email ini |

Ketiga akun lokal menggunakan kata sandi `Monitoring!2026`. Akun contoh dibuat pada database pengembangan baru saat `ADMIN_PASSWORD` kosong. Port lokal dan pilihan penyimpanan dapat diatur melalui salinan `.env.example` di `.env`.

## Profil dan pengelolaan akun

Di **Profil**, pengguna dapat mengganti nama tampilan, memilih avatar dari [IP as Logo](https://visualskills.dev/ip-as-logo), dan mengubah kata sandi. Perubahan kata sandi mengakhiri sesi lain pada akun itu.

Untuk membuat akun Developer pertama, jalankan perintah berikut dengan koneksi penyimpanan Pansus dan variabel `MONITORING_NEW_PASSWORD` berisi kata sandi awal yang sudah ditetapkan.

```powershell
npm run account -- sumbar developer developer@satker.example "Developer Satker"
```

Developer mengelola pengguna dan role di satkernya melalui **Kelola pengguna**. Pengaturan **Izin Superadmin** menentukan apakah Superadmin dapat mengelola dashboard dan menambah akun Operator atau Pembaca. Akun Developer dibuat melalui CLI. Akun Admin, Operator, dan Pembaca yang sudah ada mempertahankan perannya.

## Alur publikasi

1. Buka **Galeri template → Gunakan contoh**. Coba **Pratinjau** sebelum mengganti sumber.
2. Buka **Perbarui data**, pilih tanggal dan jam kondisi WIB, lalu unggah slot yang diperlukan. Periksa total, peringatan, dan contoh baris. Masukkan kembali kata sandi akun untuk menerapkan.
3. Buka **Terbitkan & akses**, pilih hak baca, dan terbitkan. Penanda data sintetis tetap muncul pada salinan contoh sampai data kegiatan menggantikan dataset. Dataset yang cocok dengan contoh bawaan ditahan pada pemeriksaan. Untuk simulasi alur publikasi, ubah setidaknya satu nilai status pada setiap dataset contoh sambil mempertahankan target yang diwajibkan.
4. Lakukan pembaruan berikutnya dari **Perbarui data**. Laporan kondisi terbaru menggunakan tautan pembaca yang sama. Pengunggahan kondisi lama masuk riwayat. Untuk perubahan skema angka, tinjau dan terbitkan kembali draf setelah impor.
5. Pembaca dapat memilih kondisi dan mengunduh laporan PNG. Jika rincian SLS tersedia dan diizinkan, pembaca bisa memperluas wilayah serta menyertakan rincian dalam ekspor. Laporan yang melebihi batas piksel dibagi menjadi ZIP berisi PNG bernomor.

## Pemetaan awal dan angka kontrol

| Sumber | Pemetaan pilot |
|---|---|
| Ekspor PES | SLS, Non-UB, dan UB digabung per kode kabupaten/kota. Kolom dipasang melalui ID, judul, dan alias. Target SLS dan UB divalidasi per satker. PML = selesai + ditolak + dicabut. PPL = PML + dikirim. Final = selesai. |
| `sampel FINAL` dan `Sheet9` PES | Daftar sampel menjelaskan grain dan kunci. Slot rincian opsional membaca observasi `Sheet9` atau CSV SSLS dan mencocokkan status dengan ringkasan SLS pada kondisi yang sama. Kunci `1303/040/001/000902` mempertahankan nol awal. Akses rincian kegiatan harus diaktifkan oleh pembuat. |
| Tab `14_11 14.00` dan `progres 01` PES | Inventaris awal menemukan status, persen, tenggat, dan judul berulang. Impor PES memakai tiga ekspor per dataset, dengan satuan dan ID yang tetap. Fixture H mereproduksi kontrol proyek rujukan pada **14 November 2026 pukul 13.00 WIB**. Angkanya 244 SLS, 37.470 target Non-UB, 250 target UB, dan 49 UB selesai final pada AH11. |
| `NEW 11-03-2026 15.10` Susenas–Seruti | Judul dua baris, kabupaten/kota pada B3:B21, target Susenas di C, target Seruti di O, rekap resmi pada baris 22. K dihitung dari I + J, N dari L + M, dan progres dari rata-rata K serta N. Rekap resmi disimpan terpisah dari baris wilayah. |
| `KirimBackupSplit` | Dua kondisi dengan Backup, Split, dan tanggal pengiriman per wilayah. Kondisi 10 Maret menyimpan jam kosong. Kondisi 17 Maret mencatat pukul 09.10 WIB. |
| CSV, TSV, JSON, XLSX, XLS generik | Pemetaan lanjutan menerima judul/alias, kolom wilayah, lembar/rentang dan jalur JSON. Nilai persen dipilih sebagai pecahan atau persen 0–100. Tandai baris rekap dengan label `PROV SUMBAR`. |

### Perancangan dan impor PES

Pada layar lebar, tab **Editor** menampilkan pratinjau pembaca di sisi kanan dan mengikuti perubahan draf sebelum penyimpanan. Pada layar sempit, gunakan tombol **Pratinjau langsung**. Tab **Pratinjau** menampilkan draf tersimpan dengan ruang penuh.

Di tab **Perbarui data**, pilih tiga berkas ringkasan sekaligus untuk deteksi otomatis. Berkas SLS dikenali dari kolom statusnya. Dua ekspor assignment bisa memiliki nama dan kolom serupa. UB dicocokkan ke target resmi per kabupaten/kota. Jika hasilnya ambigu, gunakan **Pilih per dataset** untuk memeriksa berkas atau menentukan pemetaan. Tanggal dan jam kondisi tetap diisi dari informasi sumber.

| Bentuk sumber | Cara membacanya |
|---|---|
| CSV/TSV | Teks UTF-8 dengan koma, titik koma, atau tab. Judul dikenali di awal ekspor. Kolom status PES boleh berubah urutan. Sel status yang kosong bernilai nol. |
| Excel | XLSX/XLS, termasuk buku kerja dengan lembar petunjuk atau judul sebelum data. Jika beberapa lembar cocok, pilih lembar di pemetaan. |
| JSON | Daftar objek, termasuk pembungkus umum seperti `data.rows`. Pilih jalur daftar dan kolom bersarang dari pemetaan bila perlu. |
| Rekap PES format panjang | Satu rekap per wilayah dan status, dengan kolom wilayah, status, dan jumlah. Baris ganda untuk kombinasi yang sama memerlukan koreksi agar angka tidak terhitung dua kali. |

Ekspor per penugasan, PDF, dan tangkapan layar memerlukan struktur sumber tersendiri. Untuk rekap PES, gunakan ekspor dengan kode wilayah dan hitungan status.

### Usulan konfigurasi dengan Gemini

Isi `GEMINI_API_KEY` pada lingkungan API. Di **Studio → Perbarui data**, unggah CSV atau Excel (XLSX/XLS) untuk dianalisis dengan **Bantuan Gemini**. Jika memakai deteksi otomatis PES atau satu workbook Susenas–Seruti, gunakan **Pilih berkas per dataset**. Jika beberapa lembar Excel cocok, isi **Nama lembar** di **Pemetaan berkas**. Template baku mendapat saran pemetaan. Sumber yang belum dikonfigurasi pada dashboard **Susun sendiri** juga mendapat saran tipe kolom dan komponen.

Untuk progres petugas, gunakan satu baris per orang dan satu kolom identitas unik seperti `nama petugas` atau `kode petugas`. Sertakan kolom `Progres (%)` atau pasangan aktual dan target. Pada dashboard **Susun sendiri**, Gemini dapat menyarankan tabel dengan kelompok **100% atau lebih**, **50%–<100%**, **Di bawah 50%**, dan **Belum ada angka**. Susunan manual tersedia melalui **Editor → Kolom data** dan **Komponen**. Rilis yang memuat rincian per orang menggunakan hak baca undangan.

Pansus hanya mengirim judul kolom yang lolos penyaringan, tipe nilai, dan ID struktur template. Isi baris, angka sumber, dan nama berkas tetap di Pansus. Server mengecek usulan terhadap seluruh CSV dan aturan template, termasuk cakupan serta target SLS/UB. Kolom kategori pada draf baru bersifat privat. Periksa usulan, terapkan ke draf atau pemetaan, lalu lanjutkan pemeriksaan dan konfirmasi impor yang biasa.

Urutan bawaan ialah Gemini 4 Carbon, Argon, Hydrogen, 3.8 Flash, 3.5 Flash-Lite, lalu 3.1 Flash-Lite. Saat model tidak tersedia, terkena kuota, kehabisan waktu, atau mengembalikan usulan yang tidak valid, API mencoba model berikutnya. Pengguna tetap dapat memakai pemetaan manual atau deteksi lokal PES.

Dua workbook operasional di `Referensi` adalah sumber baca-saja. Fixture sintetis dibangun di `fixtures/synthetic`. Jalankan `npm run fixtures` untuk menulis berkas ke `fixtures/synthetic/generated`.

Jalankan `npm run --silent schema` untuk menghasilkan JSON Schema definisi dashboard. Validasi referensi kolom, satuan, dan dependensi rumus tetap dijalankan API.

## Uji

```powershell
npm test
npm run build
npm run test:e2e
```

Uji browser mengharapkan Google Chrome terpasang di Windows. Di Linux, siapkan browser dengan `npx playwright install chromium`. Pemeriksaan mencakup rumus dan satuan, kontrol PES, kesetaraan empat format impor, riwayat, penutupan, pencabutan tautan, undangan, layar ponsel, dan ekspor penuh. Pengujian browser memakai database serta objek lokal terpisah dari pengembangan.

## Deploy ke Vercel

Hubungkan repositori dari root proyek. `vercel.json` menjalankan `npm run build:vercel`, menyajikan `dist/web`, dan mengarahkan URL Studio serta dashboard ke router React. Rute `/api/*` dilayani fungsi Node.js dari origin yang sama.

Atur `MONGODB_URI` (atau `MONGO_URI`) ke MongoDB replica set, dengan akses tulis ke `bps_monitoring` atau database yang ditentukan oleh `MONGO_DB`. Vercel menyimpan berkas di GridFS pada database yang sama jika `S3_BUCKET` belum diatur. Pemeriksaan impor dan pekerjaan ekspor berjalan saat Studio atau portal mengecek statusnya.

Atur `ADMIN_EMAIL` dan `ADMIN_PASSWORD` sebagai variabel server sebelum membuat akun admin pertama. `GEMINI_API_KEY` mengaktifkan saran konfigurasi CSV. Dashboard sintetis tersedia secara bawaan dan dapat dinonaktifkan dengan `SEED_DEMOS=false`. Jika menggunakan domain yang berbeda untuk renderer, atur `RENDER_ORIGIN` ke origin HTTPS yang dapat diakses Chromium.

Vercel membatasi payload Functions hingga 4,5 MB per permintaan atau respons. Untuk alur dengan berkas lebih besar, jalankan API dan worker di host Node.js sebagaimana di bawah. [Batas Vercel Functions](https://vercel.com/docs/functions/limitations)

## Konfigurasi staging

**API** dijalankan dari direktori proyek dengan `npm run build` lalu `npm start`. Reverse proxy menyajikan satu origin HTTPS dan mengatur `PUBLIC_ORIGIN` sesuai alamat pembaca. Aktifkan cookie Secure pada HTTPS.

**Database dan pekerjaan.** Mode pengembangan memakai SQLite lokal. Untuk staging, atur `MONGO_URI` ke MongoDB replica set agar operasi revisi dan commit memakai transaksi. Atur `REDIS_URL`, `JOBS_PROCESS=worker`, dan jalankan `npm run worker` sebagai proses terpisah dengan database serta penyimpanan bersama. `RENDER_ORIGIN` menunjuk ke alamat internal UI/API yang dapat dicapai worker.

**Berkas.** Atur `S3_BUCKET` dan, untuk penyedia kompatibel S3, `S3_ENDPOINT` serta kredensial melalui penyedia lingkungan. Gunakan bucket privat. Tanpa konfigurasi S3, objek unggahan dan laporan disimpan di `.local/objects`. Basis data menyimpan hash, status pekerjaan, versi data, dan audit. Tetapkan kebijakan siklus hidup objek sebelum menampung data kegiatan.

**Akun.** Atur `ADMIN_EMAIL` dan `ADMIN_PASSWORD` sebelum inisialisasi staging. Untuk menambah operator atau pembaca, pasang sandi sementara melalui pengelola rahasia atau variabel `MONITORING_NEW_PASSWORD`, lalu gunakan `npm run account -- sumbar operator operator@satker.example "Operator Satker"`. Gunakan peran `reader` untuk pembaca undangan. Admin menetapkan akses dashboard dari Studio.

**Pemulihan lokal.** Hentikan API dan worker, lalu cadangkan SQLite beserta file WAL/SHM yang masih ada dan direktori objek. Pulihkan ke direktori berbeda, setel `MONITORING_DB` dan `OBJECT_DIR`, dan uji bahwa pointer rilis, kondisi, serta unggahan dapat dibaca. Staging memerlukan uji pemulihan MongoDB replica set dan bucket bersama.

## Status penerimaan

| Tahap | Bukti lokal dan pekerjaan tersisa |
|---|---|
| 0–1 | Alur PES dari draf hingga rilis dan pembaruan pada URL yang sama. Kontrol 244 / 37.470 / 250 / 49 dan perhitungan H−1 diuji dengan data sintetis. |
| 2 | Adapter CSV, XLSX, XLS, JSON dan profil multi-blok Susenas–Seruti. Batch historis masih diterapkan melalui beberapa unggahan per kondisi. Rekonsiliasi lintas seluruh jam dan worksheet memerlukan pilot. |
| 3 | Galeri, editor formulir dengan simpan otomatis, tabel dan footer per tab, portal, hak baca, dan rincian SLS opsional. Editor visual Puck serta korespondensi master lintas versi masih terbuka. |
| 4 | Ekspor PNG/ZIP lokal memakai renderer bersama. Pemulihan lokal mengonfirmasi empat pointer rilis dan tiga hash berkas. Validasi MongoDB–Redis–S3, p95 pada 10 ribu dan 100 ribu observasi, uji pemulihan staging, dan tiga operator pilot masih harus dilakukan. Penyimpanan pilot belum dioptimalkan untuk target beban staging. |
| 5 | Bantuan CSV opsional memanggil Gemini langsung dengan profil kolom tersaring, validasi server, dan fallback model. Koneksi Hermes dari rencana awal serta pemilihan aset Rumah Gadang masih terbuka. |
