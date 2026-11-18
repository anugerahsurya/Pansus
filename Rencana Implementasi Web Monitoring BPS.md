# Rencana implementasi web monitoring kegiatan BPS

Dokumen kerja untuk pengembang dan agen implementasi · 17 November 2026 · BPS Provinsi Sumatera Barat

**Cara membaca.** Pengelola kegiatan dapat mulai dari §4 untuk hak akses, §6.1 untuk penamaan kolom, serta §7.1–7.3 untuk memperbarui data, membuat rumus dan memilih isi baris provinsi. Tim pengembang menggunakan §10–11 untuk menerjemahkan keputusan itu menjadi layanan dan pengujian. §9.1 menjelaskan urutan sewa dan penyambungan Hermes di Sumopod. Kamus istilah di bagian akhir memakai contoh dari alur laporan harian.

## 1. Hasil yang harus bisa didemonstrasikan

Seorang pengelola kegiatan membuka contoh dashboard, mencoba datanya, mengganti sumbernya dengan Excel kegiatan sendiri, memeriksa angka provinsi, lalu menerbitkan dashboard. Besoknya ia cukup memilih berkas baru, memeriksa perubahan, memasukkan kata sandi, dan memperbarui tautan yang sama. Seorang pembaca bisa menemukan kegiatan publik, melihat tanggal kondisi data, membuka rincian wilayah, dan membagikan laporan PNG yang utuh. Untuk kegiatan terbatas, pembaca masuk melalui tautan yang dibagikan pengelola sesuai kebijakan aksesnya.

Ukuran keberhasilan pilot yang diusulkan: tiga operator yang belum pernah memakai builder masing-masing berhasil membuat dari contoh dan memperbarui hari kedua tanpa bantuan pengembang. Catat waktu, jumlah koreksi, dan langkah yang membingungkan. Bandingkan dengan waktu yang mereka perlukan untuk memperbarui dan membagikan laporan Excel yang sama. Rekonsiliasi angka dan tidak adanya pekerjaan ulang membuat perbandingan ini bermakna.

## 2. Temuan pada sumber lokal dan dampaknya

| Bukti yang dapat diperiksa kembali | Konsekuensi implementasi |
|---|---|
| `Referensi/All About PES SE2026.xlsx` memiliki 19 sheet. `sampel FINAL` berisi 244 baris sampel dengan kode kab/kota, kecamatan, desa, SLS. Contoh lintasan kode adalah `1303 / 040 / 001 / 000902`. `Sheet9` menggunakan SSLS dengan segmen terpisah spasi. | Buat adapter kode per sumber dan versikan master wilayah. Simpan kode sebagai string, validasi hasil join dan laporkan sampel tanpa pasangan. Bedakan daftar sampel dengan observasi progres. |
| `14_11 14.00` memuat status SLS, Non-UB, UB, tenggat satker serta catatan. Dua tab 13 November menunjukkan beberapa kondisi dalam sehari. `progres 01` mengulang label status untuk kolom jumlah dan proporsi. Sheet lain berisi identitas petugas, email dan subtotal. | Identifikasi kolom dengan sheet, grup header, posisi, unit, dan versi mapping. Pilih kolom publik secara eksplisit. Simpan waktu kondisi dan revisi. |
| `Referensi/Monitoring Olah Cacah Susenas Maret dan Seruti Triwulan I 2026.xlsx` memiliki 12 sheet. Pada `NEW 11-03-2026 15.10`, baris 1–2 memisahkan Susenas dan Seruti, baris 3–21 berisi 19 kab/kota, baris 22 rekap provinsi. Kolom C dan O adalah target berbeda. Sesudah rekap terdapat informasi jadwal. | Impor per blok dengan aturan awal/akhir. Bedakan kegiatan walaupun ada di baris yang sama. Simpan rekap resmi provinsi sebagai observasi tersendiri untuk rekonsiliasi. |
| Contoh Susenas baris 3: K = I + J, N = L + M, T = rata-rata K dan N. D3 bernilai 100, sedangkan proporsi pada PES dapat tersimpan sebagai pecahan. Di baris 22 ada persentase provinsi berupa nilai langsung. `INFO` memuat jadwal dan tautan. `KirimBackupSplit` menempatkan dua tanggal kondisi berdampingan dengan status Backup dan Split. | Deklarasikan satuan sumber, rumus dan sumber agregat per indikator. Satu sheet bisa menghasilkan dua snapshot. Sediakan kartu tautan, tenggat dan status pengumpulan. |
| Proyek tetangga `D:/BPS/2. IPDS/18. PES SE2026/dashboard` memakai React/Vite, Plus Jakarta Sans, komponen grafik sendiri, tiga CSV dan riwayat per tanggal. `src/data.js`, `progress.js`, `comparison.js`, `Dashboard.jsx`, `Pace.jsx`, `exportReport.js`, `main.jsx`, `Code.gs` dan README menjadi acuan perilaku. | Port logika teruji dengan fixture. Pindahkan daftar satker, tanggal awal, tenggat, status, target dan pembulatan ke konfigurasi template PES. Render PNG lama memiliki tata letak sendiri sehingga setiap jenis widget baru perlu jalur ekspor yang konsisten. |

Folder proyek baru awalnya hanya berisi kedua workbook. Buat aplikasi di sini. Gunakan proyek PES sebagai pembanding baca-saja. Workbook cukup diperiksa secara struktural untuk rencana ini. Angka historis pada seluruh sheet dan kesesuaian angka antarjam perlu direkonsiliasi pada tahap pilot.

## 3. Arsitektur yang dipilih

**React + Vite + TypeScript untuk antarmuka, NestJS untuk API dan worker, MongoDB untuk konfigurasi serta riwayat monitoring.** Struktur dokumen cocok untuk kegiatan dengan indikator, susunan kartu dan tingkat wilayah berbeda. Akurasi tetap berasal dari kontrak kolom, mesin metrik, dan validasi pada saat impor. Satu tim dapat menggunakan tipe dan aturan yang sama dari editor sampai server. MongoDB mendukung validasi skema dan transaksi. [Validasi MongoDB](https://www.mongodb.com/docs/manual/core/schema-validation/) · [Transaksi MongoDB](https://www.mongodb.com/docs/manual/core/transactions/)

| Bagian | Keputusan dan tanggung jawab |
|---|---|
| Web pembaca dan studio admin | Dua area rute di satu aplikasi. Bundle publik memuat renderer dan komponen yang digunakan. Muat editor dan alat pemetaan saat admin membutuhkannya. Font Plus Jakarta Sans disajikan lokal. |
| API modular | Modul identitas dan akses, kegiatan, definisi dan template, wilayah, impor, publikasi, kueri, ekspor, AI. Satu layanan API untuk MVP. Semua respons pembaca berasal dari proyeksi data yang diizinkan. |
| Worker | Jalankan parsing, normalisasi, rekonsiliasi, ekspor dan pembuatan draf AI sebagai job. BullMQ/Redis untuk antrean, MongoDB sebagai catatan status yang bisa dipulihkan. API merespons dengan jobId. [NestJS Queues](https://docs.nestjs.com/techniques/queues) |
| Berkas | Penyimpanan objek privat kompatibel S3 untuk unggahan, hasil pemeriksaan dan PNG. Unduhan melalui pemeriksaan akses. Di pengembangan gunakan penyimpanan lokal dengan antarmuka yang sama. |
| UI builder | Registry React bertipe sebagai sumber komponen. Mulai dengan formulir properti, urutan seksi dan pilihan lebar penuh/setengah. Integrasikan Puck sebagai editor visual melalui adapter setelah spike membuktikan round-trip JSON, undo/redo dan akses keyboard. Format penyimpanan milik aplikasi. [Puck](https://github.com/puckeditor/puck) |
| Grafik dan tabel | Adaptasi visual PES untuk grafik batang horizontal/berkelompok, distribusi pie/donut, KPI dan progress bar. Gunakan TanStack Table untuk sorting, ekspansi dan paginasi yang dikendalikan server. Tambahkan mesin grafik lain saat ada kebutuhan terukur. [TanStack Table](https://github.com/TanStack/table) |
| Deployment | Reverse proxy HTTPS satu origin, web statis, API, worker, MongoDB replica set untuk transaksi, Redis, object store. Pisahkan dev/staging/produksi, rahasia server dan bucket tiap lingkungan. Hermes dan 9Router berada di jaringan privat. Hosting, domain, kapasitas dan kebijakan retensi mengikuti keputusan pengelola. |

Struktur repo usulan: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts` (Zod, DTO, migrasi), `packages/metrics` (evaluasi murni), `packages/widgets` (registry dan renderer), `packages/adapters` (CSV/XLSX/XLS/JSON), `templates`, `skills/dashboard-authoring`, `fixtures/synthetic`, `tests/e2e`. Ekspor kontrak ke JSON Schema untuk AI. Bangun dan uji dengan lockfile. Simpan data operasional dan kredensial di luar repo.

## 4. Alur pengguna dan hak akses

| Pengguna | Tindakan yang diizinkan |
|---|---|
| Pembaca publik | Tanpa login, cari kegiatan berdasarkan nama/satker/periode. Buka dashboard terbit, pilih kondisi data, jelajahi rincian yang diizinkan, unduh PNG. Katalog menunjukkan tanggal kondisi terakhir dan status kegiatan. |
| Pembaca undangan | Buka tautan dashboard terbatas. Untuk akses per orang, masuk dan cocokkan identitas dengan daftar undangan aktif. |
| Operator data | Pada dashboard yang ditugaskan, unggah, lihat pratinjau, konfirmasi pembaruan dengan password, lihat riwayat dan kesalahan. |
| Pembuat/pemilik | Kelola template, data contoh, mapping, indikator, widget, tema, draf, publikasi, operator, akses pembaca dan pencabutan tautan dashboard miliknya. |
| Admin satker/platform | Kelola keanggotaan, pemulihan kepemilikan dan template bersama sesuai lingkup. Semua perubahan akses dan publikasi masuk audit. |

**Visibilitas dan distribusi.** Pisahkan status konten (draf, terbit, diarsipkan) dari akses (publik, tautan rahasia, undangan). Katalog anonim mengembalikan seluruh dashboard terbit dengan akses publik. Mode tautan rahasia memberi akses kepada pemegang tautan, termasuk penerima terusan. Tampilkan penjelasan itu ketika pengelola menyalin tautan. Pilihan “Hanya orang yang diundang” memenuhi kebutuhan pembatasan identitas. Kedua mode terbatas dikecualikan dari katalog, pencarian, sitemap, metadata preview dan cache publik. Jika pengelola mengubah publik menjadi terbatas, batalkan cache publik dan akses ekspor lama di server. Salinan PNG yang sudah diunduh berada di tangan penerima.

**Mekanisme.** Modelkan anggota per satker dan penugasan per dashboard. Setiap handler turunan (riwayat, agregat, rincian, job, file, ekspor) memakai pemeriksaan izin yang sama. Token tautan acak berentropi tinggi, hash di server, bisa diberi masa berlaku, dicabut dan dirotasi. Tukar token menjadi sesi baca terbatas, bersihkan URL, redaksi log dan gunakan kebijakan referrer yang membatasi kebocoran. Periksa pencabutan setiap akses. Gunakan cookie sesi HttpOnly/Secure, proteksi CSRF dan pembatasan percobaan sandi. Default pilot memakai akun admin/operator lokal dengan hash Argon2id. Minta password akun lagi sebelum commit unggahan, lalu terbitkan bukti konfirmasi singkat yang terikat pengguna, job, dashboard dan hash isi. Jika memakai SSO kelak, gunakan reautentikasi penyedia identitas.

**Editor untuk operator non-IT.** Halaman “Buat dashboard” menawarkan “Gunakan contoh”, “Susun sendiri”, dan “Bantu dengan AI”. Ketiganya menghasilkan draf yang bisa diedit dengan kontrol sama. Langkah pengguna: pilih kegiatan dan periode → pilih data → cocokkan kolom → periksa indikator → susun tampilan → tinjau sebagai pembaca → terbitkan. Simpan draf otomatis dengan status tersimpan, undo/redo sesi, dan deteksi konflik antarpenyunting. Gunakan istilah “Angka yang dihitung”, “Dibagi dengan”, “Kode wilayah” dan tampilkan contoh hasil di sebelah pilihan. Saat pemetaan gagal, beri lokasi dan cara memperbaiki, misalnya “Sheet Progres, baris 8: kode desa 001 belum punya kecamatan.” Pembaruan harian mempunyai tombol langsung dari studio dan menggunakan mapping tersimpan.

### 4.1 Menutup kegiatan dan menghentikan penambahan data

Tambahkan status operasional **Berjalan** dan **Selesai**. Status ini berdiri sendiri dari status publikasi dan hak baca. Kegiatan yang selesai masih bisa muncul di katalog apabila sebelumnya publik. Pembaca tetap dapat membuka laporan, riwayat dan PNG. Tampilkan label “Selesai” serta tanggal penutupan di studio dan portal.

1. Admin dengan izin menutup kegiatan pada satker terkait membuka **Pengaturan kegiatan → Tandai selesai**. Dialog merangkum laporan terakhir dan jumlah unggahan yang masih menunggu. Sesudah konfirmasi, simpan status, pelaku, waktu dan alasan opsional dalam catatan perubahan.
2. Saat selesai, tombol **Perbarui data**, **Tambah baris**, dan **Terapkan hasil unggahan** dinonaktifkan dengan penjelasan “Kegiatan selesai pada [tanggal]. Hubungi admin untuk membuka kembali.” Semua jalur penambahan atau penggantian observasi tunduk pada status yang sama, termasuk CSV, impor terjadwal, koreksi tanggal lama dan API. Pembaruan akses pembaca tetap tersedia.
3. Server memeriksa status saat membuat pekerjaan unggah dan sekali lagi saat menyimpan hasil akhir. Penutupan dan penyimpanan laporan harus sama-sama memeriksa serta memperbarui nomor revisi kegiatan dalam transaksi. Jika penutupan lebih dahulu tersimpan, pekerjaan lama berhenti dengan kode `ACTIVITY_CLOSED` (HTTP 409) dan laporan aktif tetap utuh. Jika unggahan selesai lebih dahulu, dialog penutupan yang memakai revisi lama meminta admin meninjau laporan terbaru.
4. Hanya admin berizin dapat memilih **Buka kembali**, dengan alasan tercatat. Pekerjaan yang tertahan perlu ditinjau dan dikonfirmasi lagi. Untuk audit, simpan setiap peralihan status. Data lama yang belum memiliki status dibaca sebagai Berjalan saat migrasi. Default ini perlu ditinjau admin untuk kegiatan historis.

## 5. Kontrak dashboard, registry, template dan visual

Pisahkan **definisi dashboard** (apa yang ditampilkan), **mapping** (cara membaca sumber), **snapshot** (data pada waktu tertentu), dan **rilis** (versi definisi dan data yang tampil). Ketika besok operator mengunggah data, tautan dan tata letak tetap dapat dipakai. Saat editor mengubah judul, riwayat angka tetap dapat ditelusuri.

Contoh potongan definisi minimal berikut menjadi dasar fixture kontrak. Nama indikator stabil sepanjang label tampilan dapat berubah.

```json
{
  "schemaVersion": 1,
  "title": "Progres lapangan contoh",
  "timezone": "Asia/Jakarta",
  "theme": {"font": "plus-jakarta-sans", "accent": "teal", "headerAsset": "sumbar-static-v1"},
  "datasets": [{"id":"sls","grain":"sls","fields":{"selesai":"count","target":"count"}}],
  "metrics": [{"id":"rasio_selesai","dataset":"sls","op":"ratioOfSums","numerator":"selesai","denominator":"target","format":"percent","baseline":"previousCalendarDay"}],
  "sections": [{"id":"ringkasan","title":"Ringkasan","widgets":[
    {"id":"kpi1","type":"progress","version":1,"props":{"title":"SLS selesai","metric":"rasio_selesai","showDelta":true},"width":"half"}
  ]}]
}
```

Setiap entri registry mendefinisikan type/version, skema props, nilai awal, editor berbahasa Indonesia, kebutuhan data, contoh dummy, renderer layar dan mode cetak/PNG, ringkasan aksesibel, ukuran yang didukung serta migrasi. Validasi sintaks dan referensi antar-ID, tipe data, satuan, kedalaman wilayah, siklus metrik serta batas jumlah widget di API. Simpan versi definisi terbit secara immutable. Jalankan migrasi berurutan pada salinan, validasi dan sediakan rollback. Aplikasi lama yang tidak mengenali versi baru menampilkan pesan kompatibilitas di editor.

| Komponen awal | Pengaturan dan perilaku |
|---|---|
| Header kegiatan | Judul, deskripsi pendek, satker, waktu kondisi WIB, pilihan tema dan ilustrasi. Ganti warna via token CSS. Pastikan teks tetap terbaca di layar kecil. |
| Kartu angka dan progres | Pilih indikator, jumlah/target, satuan, presisi, H−1, target harian opsional. Batang visual maksimum 100%, label tetap menunjukkan capaian aktual bila melebihi target. |
| Batang horizontal dan berkelompok | Dimensi wilayah/tahap, satu atau lebih seri seunit, urutan, legenda, nilai, tooltip, tampilan semua wilayah di laporan. Jelaskan penyaringan Top N jika dipilih. |
| Pie/donut | Hanya kategori yang saling lepas pada denominator yang sama, misalnya status SLS. Sertakan jumlah, persentase dan legenda teks. Tampilkan kondisi kosong bila total nol. Tahap kumulatif PPL/PML/final lebih tepat ditampilkan sebagai batang. |
| Tabel berjenjang | Kolom dinamis, kode/nama, target, nilai, rasio, delta, tenggat, status, pencarian, ekspansi per induk dan total tetap. Tab per kelompok kegiatan seperti pada PES. |
| Kartu tautan | Label, deskripsi, URL dan ikon. Buka tab baru, beri penanda visual dan aksesibel. Validasi skema HTTPS/HTTP yang diizinkan; gunakan noopener/noreferrer. PNG memuat label dan alamat publik yang disetujui. Tautan internal tunduk pada izin tujuan. |
| Kartu jadwal/status | Rentang kegiatan, target per tanggal atau tenggat per wilayah, status pengumpulan Backup/Split dan tanggal diterima. Simbol dan teks mendampingi warna. |

**Katalog template.** Kirim dua paket awal: “Progres lapangan PES” dan “Pengolahan Susenas–Seruti”. Setiap paket berisi definisi versi, mapping contoh, dua hari data sintetis, file input contoh yang dapat diunduh, thumbnail, serta penjelasan satu paragraf tentang kegunaannya. Template PES menampilkan SLS dan penugasan Non-UB/UB. Template Susenas memisahkan Susenas dan Seruti, dilengkapi jadwal, kartu kirim backup, dan status pengumpulan. Galeri menyediakan preview desktop/ponsel. “Gunakan contoh” membuat salinan draf milik pengguna. Saat data asli masuk, ganti seluruh dataset contoh terkait secara eksplisit, tandai dataset yang belum terganti, dan blok publikasi operasional selama contoh masih tercampur. Upgrade template ditawarkan sebagai salinan/diff terpisah.

**Header bertema Sumatera Barat.** Mulai dengan header polos dan satu aset lokal statis. Periksa asal dan hak penggunaan `src/landscape.svg` sebelum memasukkannya ke katalog. Untuk Rumah Gadang, sediakan ilustrasi yang haknya dimiliki/diperoleh instansi dengan lapisan terkurasi (langit, bukit, bangunan). Pengguna memilih komposisi dan warna aksen dari preview. Manifest aset menyimpan sumber, pembuat, bukti izin, lisensi redistribusi dalam builder, teks atribusi dan poster PNG/SVG. Lisensi penggunaan ilustrasi di satu laman dapat berbeda dengan hak membagikannya sebagai koleksi untuk dipilih. Tinjau unDraw/Storyset per penggunaan; tampilkan kredit sesuai izin pada web dan ekspor. Tahap berikutnya dapat memakai Lottie/Rive dengan poster yang sama untuk ekspor, reduced-motion, koneksi lambat atau gagal muat. [unDraw](https://undraw.co/license) · [Storyset](https://storyset.com/terms)

## 6. Model penyimpanan dan kueri

| Koleksi atau penyimpanan | Isi, kunci dan pola akses |
|---|---|
| tenants, users, memberships, dashboardRoles, grants | ID internal, tenantId, peran, status, subjek undangan/tokenHash, expiry, versi pencabutan. Unik per lingkup/subjek. |
| dashboards | tenantId, dashboardId, slug, ownerId, visibility, status publikasi, activityStatus (berjalan/selesai), activityRevision, activeReleaseId, draftRevision, updatedAt. Indeks katalog pada visibility/status/tanggal. Unik slug publik atau route tenant/slug. |
| definitions, mappings, templates | Dokumen versi immutable setelah terbit. Unik (dashboardId, version) untuk definisi, (datasetId, version) untuk mapping. Catat schemaVersion dan asal template. |
| regionNodes | masterVersion, level, code, name, parentId, path. Unik (masterVersion, parentId, level, code). Indeks parentId untuk memuat anak. Master lama tetap dapat menjelaskan laporan lama. |
| imports, assets, jobs | Pemilik dan tenant, hash file, tanggal kondisi, mappingVersion, status, ringkasan pemeriksaan, referensi berkas, kunci idempotensi, percobaan dan error terstruktur. |
| snapshots, facts | Snapshot menyimpan manifest kumpulan dataset lengkap dengan waktu kondisi dan revisi. Satu fact per snapshot/dataset/wilayah/dimensi/grain, typed values serta provenance sheet/range. Unik pada kunci gabungan tersebut. Simpan per baris atau batch terukur agar dataset besar tidak terkumpul dalam satu dokumen. |
| aggregates, dayHeads, releases | Agregat per versi dan node dengan numerator/denominator/coverage. Satu dayHead per dashboard/tanggal WIB menunjuk snapshot efektif. Rilis mencatat definisi, snapshot, master dan versi mesin. Indeks untuk latest, H−1, anak per induk dan sort yang umum. |
| auditEvents | Pelaku, waktu UTC, tindakan, objek, versi sebelum/sesudah dan alasan koreksi. Hindari menyalin password, token atau isi workbook ke log. |

Semua kunci kepemilikan diverifikasi server. Materialisasikan total yang sering dibaca ketika publish. Untuk sort dinamis per saudara, mulai dengan indeks snapshot/dataset/parent, tambah indeks pada metrik yang sering diurutkan setelah mengukur. Gunakan cursor dengan tie-breaker ID, batasi page size. Perubahan master wilayah perlu tabel korespondensi eksplisit. Delta antarwilayah yang identitasnya tidak dapat disejajarkan tampil kosong dengan alasan.

### 6.1 Kolom dinamis dan cara mengaksesnya

Gunakan kamus kolom per kumpulan data. **Kolom cadangan tidak diperlukan.** Jika kegiatan menambah indikator tahun depan, server menambah satu entri kamus dan menyimpan nilai baru hanya pada baris yang memilikinya. Tampilan laporan lama tetap merujuk pada kamus dan rumus versi saat diterbitkan.

| Istilah | Contoh | Pemakaian |
|---|---|---|
| Nama pada sumber | “Jml. PPL” pada CSV, “Jumlah PPL” pada XLSX | Pemetaan boleh memiliki beberapa nama sumber yang telah disetujui. Untuk nama berulang, simpan blok/header induk atau jalur objek JSON. |
| Label tampilan | “Jumlah petugas lapangan” | Pengelola bebas mengganti label dan urutan di editor. Label ini dipakai pada kartu, tabel, dan ekspor. |
| ID kolom | `f_7a12` (contoh singkat) | ID unik dibuat server dan tidak berubah ketika sumber, posisi atau label berubah. Rumus, grafik, aturan agregat dan izin membaca merujuk ke pasangan datasetId dan fieldId. Huruf A/B/C hanya alias yang terlihat di editor. |
| Definisi kolom | Asal impor/rumus, bilangan bulat, satuan orang, boleh kosong, urutan ke-3 | Simpan tipe, satuan, skala, format tampilan, versi, dan aturan ringkasan. Nomor wilayah dan kategori nominal bertipe teks walau isinya berupa digit. |

Contoh penyimpanan satu baris adalah `{"datasetId":"petugas","regionId":"1303","values":{"f_7a12":4}}`. Saat menampilkan kolom tersebut, API memeriksa izin atas kegiatan dan field, mengambil definisi kolom versi rilis, lalu membaca nilai dengan ID. Editor menawarkan daftar label yang dapat dipilih. Jika dua label sama, tampilkan dataset dan kelompok header sebagai pembeda. Kolom baru pada unggahan masuk ke daftar “Kolom baru ditemukan”; operator dapat memetakan, membuat kolom baru atau mengabaikannya. Jika kolom wajib hilang, hentikan penerapan dan tampilkan rumus/widget yang terdampak. Menghapus kolom yang dipakai meminta pengguna mengganti referensi dahulu. Arsipkan definisi lama agar ekspor historis bisa dibuat kembali.

**Perkiraan ruang penyimpanan.** Ukur ukuran satu snapshot nyata beserta indeks, file mentah dan hasil ekspornya. Kalikan dengan frekuensi serta banyaknya versi yang dipertahankan. Misalnya 20 MB data ternormalisasi per kondisi × 2 kondisi per hari × 100 hari = sekitar 4 GB sebelum indeks, file, replika dan backup. Tampilkan pemakaian per satker dan tetapkan retensi berbeda untuk unggahan, laporan terbit dan PNG yang dapat dibuat ulang. Deduplicasikan berkas identik dalam lingkup satker melalui hash isi. Simpan ekspresi rumus sekali per versi; simpan hasil hitung yang memang perlu untuk pencarian, sorting atau reproduksi rilis. Ukur pertumbuhan lewat uji tahap 4.

## 7. Impor, riwayat dan mesin indikator

1. Operator memilih profil impor, waktu kondisi WIB dan file. Dukung XLSX multi-sheet, XLS lama, JSON, CSV, serta batch SLS/Non-UB/UB. Tampilkan kandidat sheet/blok dan beberapa baris hasil interpretasi. File pertama membangun mapping, file berikutnya memakai ulang mapping yang sama.
2. Parser worker membaca nilai dan metadata format. Tangani BOM, delimiter CSV, kutip, koma desimal, serial tanggal Excel sesuai epoch workbook, merged header, kode yang memiliki leading zero, header berulang, subtotal, baris kosong berformat dan catatan sesudah tabel. Kolom tanpa nama hanya bisa dipakai setelah diberi makna. Formula memakai nilai hasil tersimpan disertai penanda atau dihitung dari rumus bisnis terdaftar. Cache hilang → minta file disimpan ulang atau mapping kolom sumber. Hindari eksekusi macro, formula eksternal atau pengambilan URL dalam workbook.
3. Mapping mendefinisikan slot file, sheet/range, headerPath, columnId, fieldId, tipe, skala persen, grain, aturan filter/berhenti, kunci wilayah dan lookup nama. Ketika header berpindah, cari berdasarkan struktur unik. Header hilang, ambigu atau satuan berubah → tahan job untuk remapping, tampilkan sel terdampak. Simpan versi mapping dan sediakan unduhan daftar kesalahan.
4. Validasi duplikat pada grain, parent hilang, status tak dikenal, kelengkapan slot, jumlah negatif yang tidak diizinkan, jenis data dan cakupan wilayah. Bandingkan dengan versi aktif: wilayah baru/hilang, perubahan target, indikator kosong, selisih terhadap provinsi resmi. Tentukan aturan per template untuk kesalahan penghalang dan peringatan yang bisa diterima dengan alasan. Status kosong memiliki arti sesuai mapping; default adalah belum tersedia. Pembaruan standar mengganti seluruh kumpulan yang dipilih. Pembaruan parsial wajib memilih cakupan dan memperlihatkan dataset yang diwarisi beserta waktu kondisinya.
5. Job bergerak dari uploaded → validating → needs_mapping/invalid atau ready → committing → published/failed. Pisahkan konfirmasi upload dari publikasi perubahan desain. Operator berizin dapat menerapkan snapshot ke definisi aktif setelah preview dan konfirmasi sandi. Jika belum ada publikasi, simpan sebagai data draf untuk pemilik.
6. Tulis facts/agregat ke versi staging. Validasi seluruh hasil, lalu transaksikan pointer dayHead, manifest rilis/activeRelease, status job dan audit. Gunakan compare-and-swap terhadap revisi dasar. Konflik mengembalikan 409 dan preview baru. Kunci idempotensi meliputi dashboard, slot/hash, mapping, waktu kondisi dan opsi. Retry dari job sama menghasilkan satu hasil. Worker yang mati sebelum commit bisa dilanjutkan; bersihkan staging tak terpakai sesudah masa retensi. Rollback membuat rilis baru yang menunjuk versi lama.
7. Beberapa jam dalam sehari disimpan. Default dayHead memilih jam kondisi terbesar yang disetujui, unggah ulang jam sama membuat revisi baru. Koreksi jam lebih awal tetap tersedia dalam riwayat; penggantian head secara eksplisit perlu alasan. Tanggal terbesar menjadi kondisi terkini. Koreksi mundur memperbarui acuan H+1 yang relevan. Kunci cache delta dengan ID snapshot hari terpilih dan ID baseline, sehingga hasil ekspor lama tetap dapat direproduksi.

**Definisi angka.** Sediakan operasi bertipe sum, count, difference, mean, mode, ratioOfSums, weightedMean, none dan reportedValue. Setiap metrik mempunyai unit, grain, kebijakan null, cakupan, presisi, sumber dan arah keberhasilan. Mesin yang sama menghitung angka untuk kartu, grafik, tabel dan PNG. Bulatkan saat format akhir. Proporsi 0–1 dan persen 0–100 dikonversi sesuai deklarasi field, termasuk ketika nilai sumber adalah 1. Pesan “target belum tersedia” berbeda dari “0 selesai”.

| Kasus | Aturan yang dapat diuji |
|---|---|
| PES Non-UB/UB | target = jumlah status penugasan yang dipetakan. PML = completed + rejected + revoked. PPL = PML + submitted. Final = completed. Gap = PPL − PML. Validasi jumlah status SLS dan target UB terhadap master contoh PES. Jangan gunakan definisi PPL ini pada semua kegiatan. |
| Target sesuai waktu | Pertahankan cara `targetRatio` dan `achievement` PES pada fixture rujukan: hari kegiatan mulai 1 November 2026, offset PPL 0 hari dan PML/final 1 hari, tenggat per satker, target provinsi tertimbang target satker. Parameterkan tanggal, offset, penanganan sebelum mulai/setelah tenggat dan presisi label. |
| Delta harian | Bandingkan tanggal kalender H dengan H−1 WIB menggunakan target masing-masing, grain, cakupan, versi definisi indikator yang kompatibel dan ID wilayah. 30/100 menjadi 42/120 berarti 30% → 35%, delta +5 poin persentase. Label default “+5 pp”, tooltip “naik 5 poin persentase dibanding kemarin”. Template PES dapat memakai format lama “+5%” dengan keterangan yang sama. H−1 hilang, denominator nol, cakupan berubah tak sebanding atau versi definisi tak kompatibel menghasilkan tanda “—” dan alasan. |
| Provinsi | Untuk rasio hitungan: 1/2 dan 9/10 menghasilkan 10/12 = 83,33%. Untuk Susenas yang hanya menyediakan persen kab/kota, pilih nilai resmi baris 22 atau pembobotan target yang disahkan pemilik indikator. Simpan keduanya bila dibutuhkan dengan label sumber dan selisih. Agregat resmi tidak ikut dijumlahkan dengan anak. Persen yang dibulatkan tidak cukup untuk merekonstruksi jumlah tepat. |
| Kedalaman wilayah | Default tabel menampilkan kab/kota. Tombol perluas hanya untuk node yang punya rincian dalam dataset dan snapshot tersebut. Anak dimuat saat diklik; perlihatkan kecamatan → desa/kelurahan → SLS sejauh data tersedia. Target/daftar sampel boleh memiliki detail sendiri meskipun progres pengolahan berhenti pada kab/kota. Cakupan parsial diberi label, misalnya “8 dari 10 SLS memiliki laporan”. |
| Sorting dan pencarian | Angka dan rasio diurutkan dengan nilai mentah, tanggal secara kronologis, nama dengan kolasi Indonesia, kode sebagai identitas teks. Urutan stabil saat seri, null terakhir di dua arah. Klik header menggilir urutan awal, terbalik, lalu urutan sumber. Urutkan saudara di dalam parent sebelum paginasi, pertahankan baris total dan hubungan anak. Pencarian hasil anak memperlihatkan jalur induknya. |

### 7.1 Pembaruan harian dengan CSV, Excel dan JSON

CSV sudah menjadi jalur pembaruan rutin sejak tahap 1. Operator menekan **Perbarui data**, memilih tanggal/jam kondisi, memilih file untuk setiap slot yang dibutuhkan, lalu memeriksa nama sumber, jumlah baris, perubahan angka dan contoh hasil rumus. Setelah konfirmasi password, laporan baru terbit pada alamat yang sama. Menutup tab atau menekan “Coba lagi” sesudah gangguan koneksi dapat memeriksa kembali nomor pekerjaan sebelumnya. Pengujian harus membuktikan satu unggahan tidak terhitung dua kali.

| Format masuk | Keputusan untuk implementasi dan pemeriksaan |
|---|---|
| CSV | Tampilkan contoh pemisah koma/titik koma/tab, kutipan dan pengkodean teks. Izinkan koreksi jika deteksi salah. Jaga kode wilayah sebagai teks. Uji nilai desimal Indonesia dalam file berpemisah titik koma dan nama wilayah yang mengandung koma dalam tanda kutip. |
| XLSX | Pilih lembar, baris judul dan blok. Tampilkan angka sumber serta satuannya. Bedakan rumus workbook yang memiliki nilai tersimpan dengan rumus yang baru dibuat di studio. |
| XLS | Sediakan pembaca khusus format Excel lama (BIFF). Periksa jenis file dari isinya; mengganti ekstensi tidak mengonversi file. Uji sheet, tanggal, kode berformat nol awal, formula dengan cache dan file rusak. Bila terenkripsi atau varian belum didukung, jelaskan cara menyimpan salinan sebagai XLSX/CSV dan pertahankan mapping yang sudah dibuat. |
| JSON | Terima daftar objek, atau objek dengan jalur daftar yang dipilih pengguna, misalnya `data.wilayah`. Pilih nilai bersarang melalui jalur seperti `status.selesai`. Pratinjau membedakan nilai kosong, nol dan properti hilang. Daftar bersarang lain memerlukan pemetaan eksplisit untuk mencegah satu observasi tergandakan. |

Tiap pembaca format menghasilkan bentuk baris yang sama: fieldId, nilai bertipe, kunci observasi, dan lokasi asal (baris CSV, sel Excel atau jalur JSON). Semua format melewati validasi, rumus, pengecekan status kegiatan, pratinjau, konfirmasi dan riwayat yang sama. Untuk menambah format berikutnya, buat pembaca baru serta fixture perbandingan untuk data logis yang sama.

### 7.2 Kolom rumus buatan pengelola

Di studio pilih **Tambah kolom → Hitung dengan rumus**, isi nama, satuan dan presisi, lalu pilih kolom dari daftar atau ketik ekspresi. Contoh: A = jumlah tim, B = kapasitas per tim, C = kapasitas tambahan, D = total kapasitas. Ketika pengguna mengetik `A * B + C`, editor menampilkan kembali **[Jumlah tim] × [Kapasitas per tim] + [Kapasitas tambahan]**. Dengan A = 2, B = 5 dan C = 3, pratinjau D harus menampilkan 13. Simpan referensi ke ID yang dipilih. Memindahkan kolom B pada CSV besok tetap menghasilkan perhitungan yang sama setelah pemetaan.

1. Versi awal mendukung konstanta angka, kolom numerik pada dataset dan tingkat observasi yang sama, operasi tambah/kurang/kali/bagi, tanda negatif dan tanda kurung. Perkalian dan pembagian didahulukan dari penjumlahan dan pengurangan. Tampilkan arti satuan dan minta pengguna menetapkan satuan hasil. Penjumlahan/pengurangan memerlukan satuan yang kompatibel.
2. Parser mengubah ekspresi menjadi **pohon operasi**. Untuk contoh D, operasi terluarnya “tambah”, dengan anak “kali(A,B)” dan kolom C. Simpan pohon, dependensi, versi definisi serta format tampilan. Server mengevaluasi hanya operasi dalam daftar yang didukung. Formula dari AI melewati evaluator dan izin yang sama.
3. Kolom rumus boleh memakai kolom hasil lain. Urutkan perhitungan menurut dependensi. Tolak referensi berputar seperti D memakai E sementara E memakai D, dan tunjukkan jalurnya. Cegah referensi lintas izin, termasuk penerbitan hasil turunan yang membuka data terbatas tanpa persetujuan eksplisit pemilik data.
4. Jika operand kosong atau pembagi nol, hasil menjadi kosong dengan alasan yang dapat dilihat operator. Tipe tidak sesuai, kolom tidak dikenal dan sintaks salah harus menampilkan lokasi kesalahan sebelum rumus disimpan. Hitung dengan presisi yang konsisten, bulatkan saat ditampilkan. Uji `2*(5+3)=16`, `2*5+3=13` dan kasus kosong/nol.
5. Hitung D ketika data sumber hari baru masuk. Edit rumus menghasilkan versi baru: perlihatkan dampak terhadap tabel, kartu, delta, serta rekap sebelum menerbitkan. Rekalkulasi historis merupakan tindakan terpisah dengan rentang tanggal dan persetujuan pemilik. Bedakan “hitung per wilayah lalu ringkas” dari “hitung dari angka provinsi” pada kartu pengaturan.

### 7.3 Baris paling bawah “Provinsi Sumatera Barat”

Di **Pengaturan tabel → Ringkasan provinsi**, pembuat memilih **Tampilkan baris Provinsi Sumatera Barat**. Terapkan per tabel/tab, dengan default aktif pada dua template Sumbar. Saat aktif, letakkan baris satu kali di bawah seluruh kab/kota, setelah baris wilayah terakhir pada ekspor lengkap. Sorting, pencarian, pergantian halaman dan membuka SLS tidak memindahkan baris ke tengah. Default angka provinsi menggunakan seluruh wilayah yang diizinkan dalam cakupan provinsi pada tanggal terpilih, independen dari halaman. Jika pengguna memfilter beberapa wilayah, beri keterangan “Seluruh provinsi” untuk angka penuh. Jika pembaca hanya berhak pada sebagian wilayah, sembunyikan nilai provinsi penuh kecuali ada izin terpisah untuk agregat tersebut. Pilihan “Ringkasan wilayah terpilih” memakai label tersendiri. Mematikan baris memengaruhi tabel serta PNG tabel itu; kartu provinsi yang dipilih tersendiri tetap mengikuti konfigurasinya.

| Pilihan per kolom | Makna dan contoh |
|---|---|
| Jumlah | Jumlahkan observasi pada satu tingkat yang ditentukan, misalnya target dari setiap kab/kota satu kali. Keluarkan baris provinsi/subtotal dari himpunan anak. |
| Rata-rata | Setiap wilayah bernilai memiliki bobot satu. Dari 20, kosong, dan 40 diperoleh 30 dengan keterangan “2 dari 3 wilayah”. Nol ikut dihitung. |
| Rata-rata tertimbang / rasio jumlah | Pengguna memilih kolom bobot, atau memilih pembilang dan penyebut. Untuk progres, 1/2 dan 9/10 menghasilkan 10/12 = 83,33%. Beri alasan jika bobot total atau penyebut nol. |
| Modus | Pilih kategori yang paling sering muncul di antara observasi valid pada tingkat terpilih. Untuk “Sudah, Sudah, Belum” hasilnya “Sudah”. Gunakan kode kategori kanonik. Jika frekuensi tertinggi seri, tampilkan “Tidak ada modus tunggal” dan daftar kategori seri pada keterangan. |
| Kosongkan | Default untuk nama petugas, kode administratif, nomor dokumen atau label nominal tanpa makna ringkasan. Simpan nilai kosong disertai alasan “Tidak diringkas”. Kolom nominal dengan kategori bermakna dapat diatur ke modus. |
| Ambil nilai provinsi dari sumber | Pilih baris dan kolom rekap resmi, misalnya `PROV SUMBAR`. Bila nilai hilang, beri penanda dan minta pengelola meninjau aturan sebelum memakai metode pengganti. |
| Rumus di tingkat provinsi | Pilih secara eksplisit untuk indikator yang didefinisikan dari komponen provinsi. Untuk D = A × B + C, dua baris (2,5,3) dan (1,4,0) menghasilkan D sebesar 13 dan 4. “Jumlah hasil tiap wilayah” menghasilkan 17. Menerapkan rumus ke jumlah A, B, C menghasilkan 30. Preview menunjukkan kedua hasil serta metode yang akan diterbitkan. |

Kontrak tabel menyimpan `provinceFooter.enabled`, label, cakupan, tingkat baris sumber dan aturan per fieldId. Mesin menghitung ringkasan dari observasi unik versi data yang sama sebelum paginasi. Semua nilai kosong menghasilkan kosong. Tampilkan jumlah wilayah valid dibanding jumlah yang diharapkan jika data parsial. Editor hanya menawarkan metode yang sesuai tipe, misalnya rata-rata untuk angka dan modus untuk kategori. Simpan metode dan cakupan bersama rilis agar tabel web, tooltip, PNG serta riwayat dapat diperiksa kembali.

## 8. Ekspor utuh dan aksesibilitas

“Unduh PNG lengkap” menangkap seluruh seksi, semua tab dataset dan seluruh baris yang sesuai cakupan pilihan. Default laporan mencakup semua wilayah pada level ringkasan. Tawarkan “Sertakan semua rincian sampai …” dan tampilkan estimasi baris. Jika filter wilayah aktif, nyatakan cakupan pada dialog dan judul laporan, sediakan “Seluruh wilayah”. Bekukan releaseId, baselineId, filter, sort, depth dan versi aset ketika permintaan diterima.

Worker membuka route render internal via Chromium dengan tiket terbatas, render mode laporan dari registry yang sama, tanpa virtualisasi/pagination, tabel melebar atau dipecah kolom dengan pengenal wilayah diulang. Tunggu font, svg, poster, layout dan seluruh data siap. Sertakan tanggal kondisi, legenda, unit, delta, sumber angka serta atribusi. Cek dimensi sebelum alokasi. Upayakan satu PNG; bila jumlah SLS melampaui anggaran piksel, beri tahu pengguna dan hasilkan ZIP PNG bernomor dengan header, cakupan dan nomor halaman berulang. Setiap baris tetap disertakan. Export memakai izin pembaca dan proyeksi kolom yang sama dengan layar. Uji jumlah baris/seri dan sentinel baris terakhir selain membandingkan gambar.

Gunakan tata letak responsif, label bahasa Indonesia, target klik yang cukup besar, kontras yang teruji, kontrol sorting dan ekspansi lewat keyboard dengan aria-sort/aria-expanded, ringkasan teks dan tabel pendamping grafik. Sediakan pilihan pindah atas/bawah selain drag, fokus yang kembali ke pemicu, pengumuman hasil impor untuk pembaca layar, serta state loading, kosong, gagal dan coba lagi. Hormati preferensi reduced motion.

## 9. Pembuatan dengan AI

**Tujuan operator:** “Saya mau memantau progres lapangan per kabupaten, melihat selisih dengan kemarin, dan membagikan tautan pedoman.” Sistem dapat memilih komponen dan menyusun draf, sementara definisi “selesai” tetap berasal dari field dan aturan yang dikonfirmasi pengelola.

| Form singkat (pertanyaan lanjutan muncul sesuai jawaban) | Nilai untuk sistem |
|---|---|
| Kegiatan apa, siapa pembaca, keputusan apa yang perlu diambil? | Judul, bahasa, prioritas indikator, ringkasan vs detail. |
| Apa sumber data, satu baris mewakili apa, sampai tingkat mana? | Pilih profil terverifikasi, dataset, grain, kunci dan hierarki. |
| Angka utama apa, kapan dianggap selesai, dibandingkan dengan target apa? | Mapping pembilang, penyebut, sumber angka provinsi, unit dan target waktu. Jika ambigu, ajukan satu pertanyaan terarah sebelum menerima rumus. |
| Kapan diperbarui, perlu delta atau tenggat? | Frekuensi, waktu kondisi dan baseline. |
| Grafik, tabel, tautan, tema, dan contoh mana yang disukai? | Preferensi urutan dan properti widget. Form menyediakan pilihan “Gunakan saran”. |
| Siapa yang boleh melihat dan seberapa rinci? | Saran mode akses dan proyeksi kolom. Pemilik menetapkan akses di aplikasi sebelum publikasi. |

Alur: API membuat profil lokal berisi ID kolom, tipe, satuan, kategori yang diizinkan dan nilai contoh sintetis. Tampilkan kepada pengguna ringkasan informasi yang akan dikirim. Worker memanggil Hermes dengan skill `dashboard-authoring`, konfigurasi endpoint privat 9Router dan model OpenCode Big Pickle yang ditemukan saat runtime. Skill memuat daftar komponen/versi, schema, aturan metrik, batas akses, contoh PES dan Susenas sintetis, contoh klarifikasi dan format jawaban. Hasil bertipe `{draft, assumptions, questions, warnings}`. Jawaban divalidasi Zod, dicek referensi data dan izin, lalu dirender terhadap contoh lokal. Tampilkan asumsi dan perubahan per widget, sediakan “Pakai draf”, “Ubah sendiri”, dan “Buat ulang bagian ini”. Semua draf tetap dapat dibuka editor manual.

Jalankan Hermes dalam worker terisolasi dengan katalog skill baca-saja, tanpa akses DB, shell, filesystem pengguna, atau kredensial publikasi. Filter akses jaringan ke router; pisahkan konteks per tenant/job. Cegah pengiriman workbook, email, nama petugas, tautan rahasia dan catatan bebas yang belum ditinjau. Instruksi di dalam sel dianggap data. Log hanya metadata teredaksi, versi skill/model, schema, status dan durasi. Model hanya mengusulkan definisi deklaratif. Aplikasi mengevaluasi operasi terdaftar tanpa eval/JS/HTML bebas.

Spike wajib sebelum mengaktifkan tombol AI: temukan model pada router terpasang, uji panggilan nyata melalui Hermes → 9Router → OpenCode dengan data sintetis, parsing JSON, timeout, kredensial salah, kuota habis dan dua tenant paralel. Simpan model ID hasil discovery di konfigurasi deployment. Jika skema gagal, beri satu kesempatan perbaikan terbatas; setelah gagal tawarkan template yang cocok dan pertahankan isian form. Sediakan feature flag, pembatasan pemakaian, dan batas biaya/retry per job. Dokumentasi OpenCode menyebut data Big Pickle pada periode gratis dapat dipakai untuk perbaikan model; ketersediaan dan aturan harus diperiksa saat deployment. [Provider Hermes](https://hermes-agent.nousresearch.com/docs/integrations/providers) · [9Router](https://github.com/decolua/9router) · [Model dan privasi OpenCode](https://opencode.ai/docs/console/models/)

### 9.1 Dari menyewa Hermes di Sumopod sampai draf pertama

Pembagian peran: Sumopod menjalankan layanan Hermes. Worker web monitoring mengirim permintaan penyusunan draf ke Hermes. Hermes memakai 9Router untuk meneruskan permintaan model ke OpenCode. Big Pickle adalah model yang menghasilkan usulan. Data kegiatan dan keputusan publikasi dikelola di backend monitoring. Berikut urutan pilot dengan data sintetis.

1. **Sebelum memilih paket**, pastikan template Hermes menyediakan cara memasang skill sendiri, menyimpan konfigurasi setelah redeploy, menjalankan API server Hermes, menyediakan jalur HTTPS yang dapat diakses worker, dan menjangkau alamat 9Router. Periksa region, kapasitas, biaya layanan dan biaya penyedia model secara terpisah. Catat hasil pemeriksaan pada akun/paket yang dipilih. Jika template hanya membuka konsol admin, minta opsi route API atau gunakan layanan container/VPS yang memungkinkan pengaturan tersebut sebelum melanjutkan integrasi. [Mulai memakai Sumopod](https://docs.sumopod.com/introduction)
2. **Buat instance staging.** Masuk ke dashboard Sumopod, pilih Apps (Services), temukan Hermes dan periksa ringkasan paket sebelum deploy. Buka layanan, catat alamat konsol dan alamat API yang benar-benar disediakan. Untuk perubahan konfigurasi gunakan Configuration → Environment Variables → Save and Deploy, cek Recent Deployments dan buka tab Access. Simpan salinan konfigurasi sebelumnya di tempat aman karena perubahan variabel dapat memulai ulang layanan. [Panduan redeploy Hermes Sumopod](https://docs.sumopod.com/guides/services/hermes/update-hermes)
3. **Siapkan dua koneksi terpisah.** Worker menyimpan alamat API Hermes dan kunci akses worker→Hermes. Di Hermes aktifkan API server dengan `API_SERVER_ENABLED=true`, atur `API_SERVER_KEY` dan listener sesuai jaringan/proxy paket. Daftarkan 9Router sebagai provider dengan alamat dasar yang bisa dijangkau dari instance Hermes, kredensial Hermes→9Router dan model ID yang terdeteksi. Router di laptop dengan alamat localhost tidak dapat dijangkau instance cloud melalui alamat itu. Gunakan jalur privat atau HTTPS berautentikasi sesuai deployment. Kredensial layanan disimpan di server. [API server Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) · [Provider Hermes](https://hermes-agent.nousresearch.com/docs/integrations/providers)
4. **Pasang skill versi terpilih.** Muat paket dashboard-authoring dan schema widget dari repo melalui mekanisme yang didukung paket. Pakai profil khusus aplikasi dengan alat terbatas sesuai §9. Catat versi skill, konfigurasi provider dan prosedur pemulihan. Redeploy di staging dan pastikan skill serta konfigurasi masih terbaca.
5. **Uji dari worker.** Periksa health, lalu kirim permintaan sintetis ke `POST /v1/chat/completions` memakai bearer token. Minta draf dua widget dari kolom contoh. Buktikan request mencapai model melalui router, keluaran lolos validasi, dan pratinjau muncul di studio. Periksa juga token salah, model hilang, timeout dan dua pekerjaan milik satker berbeda. Tes membuka halaman admin saja belum memverifikasi jalur ini.
6. **Aktifkan untuk pilot** ketika pengelola menerima hasil uji dan kebijakan metadata. Pantau biaya, durasi, error dan kuota. Jika layanan terganggu, hentikan permintaan baru melalui sakelar fitur; pekerjaan pengguna dapat diteruskan dari form ke template manual. Catat cara mengganti kunci, memulihkan skill/config, dan menguji kembali setelah Sumopod atau router diperbarui.

## 10. Permukaan API minimum

| Endpoint usulan | Kontrak perilaku |
|---|---|
| GET /catalog, GET /d/:slug | Katalog hanya publik terbit. Resolve slug ke manifest terotorisasi dengan versi, tanggal tersedia, indikator dan widget aman. |
| POST /share/exchange, POST /auth/login, POST /auth/confirm | Sesi baca link, sesi akun dan bukti autentikasi ulang untuk operasi sensitif. |
| POST /admin/dashboards, PATCH /admin/dashboards/:id/draft | Mulai kosong/dari template, simpan dengan expectedRevision. GET preview menyertakan draftRevision. |
| POST /admin/dashboards/:id/imports, GET /admin/imports/:id/preview, POST /admin/imports/:id/commit | Multipart per slot atau upload privat terikat job. Preview mengembalikan errors/warnings per sheet/row/field, diff dan hash pratinjau. Commit memerlukan hash, revision, konfirmasi dan idempotencyKey. |
| POST /admin/dashboards/:id/publish, POST /admin/dashboards/:id/rollback | Bekukan definisi tervalidasi dan manifest data. Kembalikan releaseId serta versi sebelumnya. |
| GET /dashboards/:id/history, GET /dashboards/:id/view, GET /dashboards/:id/children | Resolusi tanggal ke rilis, query dengan releaseId, dataset, parent, filter, sort, cursor. Kembalikan typed values, deltaReason, source, coverage, hasChildren dan nextCursor. |
| POST /dashboards/:id/exports, GET /jobs/:id, GET /exports/:id/download | API mengambil identitas dari sesi, memeriksa izin saat memulai dan mengambil hasil, mengembalikan status dan hasil privat. |
| POST/DELETE /admin/dashboards/:id/grants, PATCH /admin/dashboards/:id/access | Atur mode, undang/cabut/rotasi, invalidasi cache dan sesi terkait. |
| POST /admin/dashboards/:id/close, POST /admin/dashboards/:id/reopen | Khusus admin sesuai lingkup. Periksa expectedActivityRevision, simpan status dan audit. Commit data menolak status selesai. |
| POST /admin/dashboards/:id/formulas/preview | Validasi ekspresi dan akses field, tampilkan contoh hasil serta kesalahan per baris. Simpan rumus dan konfigurasi footer melalui endpoint draf dengan pemeriksaan revisi. |
| GET /templates, GET /admin/widget-catalog, POST /admin/dashboards/:id/ai-drafts | Ambil paket contoh dan registry terversi; generasi asinkron mengembalikan usulan draf beserta pertanyaan. |

Gunakan error envelope dengan code, pesan operator, field/location, retryable, requestId. Bedakan 401 sesi habis, 403 izin operasi, 404 untuk objek terbatas yang tak boleh diketahui, 409 konflik revisi, 422 data tidak valid, 429 batas permintaan. Setiap job memiliki halaman status yang dapat dibuka setelah refresh.

## 11. Urutan eksekusi dan kriteria selesai

| Tahap dan prasyarat | Pekerjaan | Bukti selesai sebelum lanjut |
|---|---|---|
| 0 · Kontrak dan fixture | Buat inventaris field/worksheet, daftar unit, mapping PES/Susenas, master contoh serta dua hari fixture anonim. Tetapkan asumsi agregat dengan pengelola. Catat angka kontrol dan sumber waktu masing-masing. | Uji acuan menghitung PPL/PML/final/target, rasio tertimbang dan delta dengan target berubah. Contoh tidak mengandung identitas orang. |
| 1 · Alur utuh PES | Siapkan repo, auth, tenant, database, registry minimum, template PES, impor tiga CSV, pemeriksaan sandi, publish dan satu view pembaca. Gunakan komponen lama sebagai pembanding. | Operator mengunggah H−1 dan H, dua perangkat membaca rilis yang sama. Bandingkan fixture bawaan PES dengan total SLS 244, target Non-UB 37.470, target UB 250 dan nilai AH11 49 sesuai README sumber pada kondisi yang cocok. |
| 2 · Workbook dan riwayat | Tambah XLSX multi-blok, pemetaan ulang, Susenas–Seruti, status Backup/Split, import historis berurutan waktu, koreksi dan rekonsiliasi. | Kedua kegiatan dari satu sheet punya target tepat. Berkas yang keliru menghasilkan laporan baris. Unggah ulang, konflik, crash dan tanggal mundur menghasilkan riwayat konsisten. |
| 3 · Studio dan portal | Wizard, template dummy, komponen lengkap, sorting, tampilan ponsel, hierarki, tema, tautan dan kontrol akses terbatas. | Operator menyalin template, mengganti sumber, menambah kartu tanpa coding. Pengunjung anonim melihat semua kegiatan publik dan nol kegiatan tersembunyi. Rincian SLS hanya muncul pada indikator yang mendukungnya. |
| 4 · Ekspor dan pilot | Ekspor utuh, regresi visual, uji akses lintas tenant, uji beban dengan data sintetis setingkat SLS, backup/restore, panduan operator singkat. | PNG memuat isi di bawah fold dan halaman akhir tabel; ekspor besar lengkap dalam beberapa PNG. Pengelola memulihkan satu rilis dan ketiga operator menyelesaikan skenario pilot. |
| 5 · AI dan editor lanjutan | Spike endpoint, skill registry, form, validasi, review, fallback, tambahan aset berlisensi serta drag/resize apabila lolos uji kegunaan. | Dua template dapat direkonstruksi sebagai draf valid dari form. Timeout atau respons AI salah tetap membawa operator ke editor dengan inputnya. Uji provider nyata terdokumentasi sebelum diaktifkan pada produksi. |

**Matriks regresi lintas tahap.** Sertakan unit test metrik dan adapter, integrasi transaksi, kontrak schema/migrasi, serta Playwright untuk alur pembaca dan admin. Uji duplikat SSLS lintas desa, nol di awal kode, header bertingkat/berulang, perubahan format kolom, tanggal lintas bulan/tahun, target nol, persentase >100, H−1 hilang, dua unggahan hari sama, dan konflik dua editor. Uji sorting 2/10/100, nama beraksen, dua nilai seri, nilai kosong di kedua arah, dan parent yang dibuka saat urutan berubah. Uji URL terbatas yang diteruskan untuk mode link dan mode identitas, pencabutan saat ekspor berjalan, akses ke metadata job milik satker lain, serta cache setelah akses publik dicabut. Gunakan snapshot/screenshot desktop dan ponsel untuk setiap widget.

**Target operasi awal yang perlu dibuktikan di staging.** Ukur p95 buka ringkasan dan buka daftar anak (sasaran awal masing-masing ≤2 detik dan ≤1 detik pada data hangat). Gunakan profil 19 kab/kota, 10 ribu lalu 100 ribu observasi sintetis, 20 pembaca serentak dan dua unggahan. Catat spesifikasi mesin, waktu impor/ekspor, penggunaan memori dan ukuran PNG. Tetapkan batas file, sel dan piksel dari hasil uji. Pasang metrik panjang antrean, error parsing, waktu commit, gagal ekspor dan kegagalan provider. Tampilkan waktu kondisi data kepada pembaca dan waktu unggah kepada operator. Jadwalkan backup DB serta objek, uji pemulihan keduanya ke staging, verifikasi hash dan pointer rilis, dan dokumentasikan rollback aplikasi beserta kompatibilitas skema.

**Kesinambungan dengan Sheets.** Referensi PES juga menawarkan sinkronisasi tab laporan ke Google Sheets. Bila satker masih membutuhkannya, implementasikan konektor per dashboard melalui outbox setelah commit, dengan idempotensi per rilis, status sinkronisasi, retry dan tombol kirim ulang. Gangguan Google tidak membatalkan penerbitan di portal. Konfirmasi kebutuhan ini di pilot sebelum memensiunkan alur lama. Sumber masa depan (API, folder unggahan terjadwal) masuk melalui kontrak adapter yang sama dan tetap melewati preview/aturan validasi sesuai kebijakan kegiatan.

### 11.1 Uji penerimaan tambahan untuk eksekutor

| Tahap | Skenario dan bukti yang harus diperlihatkan |
|---|---|
| 0–1 | Daftar kolom dengan ID tetap dan dua CSV harian. Unggahan kedua menukar posisi A/B dan mengganti header memakai alias yang disetujui. D pada kedua laporan cocok dengan hitung tangan, tanpa memilih ulang setiap kolom. |
| 2 | Data contoh yang sama dikirim dalam CSV, XLSX, XLS, dan JSON. Periksa kunci wilayah, angka, null, hasil rumus dan rekap. Contoh format rusak menghasilkan pesan sumber/baris yang dapat ditindaklanjuti. |
| 2–3 | Aktif/nonaktifkan footer dua tabel secara independen. Uji mean, weighted mean, mode seri, kosong nominal, rekap resmi, kalkulasi D, filter, hak baca terbatas, paginasi dan ekspor. Laporan lama tetap memakai aturan versi lama. |
| 3 | Tambah field baru tanpa kolom cadangan. Ganti labelnya, pindah urutan, coba hapus field yang masih dipakai. Kartu, formula dan riwayat tetap dapat dijelaskan. |
| 3–4 | Admin menutup kegiatan bersamaan dengan commit unggahan. Hanya urutan yang sah tersimpan. Coba tambah data langsung melalui API dan worker terjadwal, baca laporan lama, buka kembali dengan alasan dan unggah ulang melalui pratinjau. |
| 5 | Dari instance staging Sumopod, worker mendapat satu draf valid melalui Hermes dan router. Setelah redeploy, ulangi dengan skill versi yang tercatat dan buktikan jalur manual tetap berfungsi saat koneksi diputus. |

## 12. Handoff ke GPT 6.1 Sol

Mulai dari tahap 0 dan satu alur PES yang dapat dijalankan ujung ke ujung. Periksa file sumber pada §2, catat pemetaan field dan jam kondisi aktual ketika membangun fixture. Gunakan berkas sintetis untuk repo dan CI. Implementasikan kontrak dan uji angka sebelum memperluas editor. Pada akhir setiap tahap, laporkan perubahan, cara menjalankan, hasil uji, contoh peran pengguna dan kriteria yang masih terbuka. Semua jalur pembuatan harus berbagi renderer, validator, evaluator dan API publikasi.

Keputusan untuk pilot: pemilik indikator menetapkan sumber resmi angka provinsi Susenas, aturan cakupan parsial dan kolom yang boleh dipublikasikan sampai SLS. Pengelola platform menetapkan hosting, pemilik akun, retensi, izin pengiriman metadata ke AI serta hak aset. Default pengembangan dapat langsung berjalan dengan data sintetis, akun lokal, dashboard draf, dan AI nonaktif. Keputusan operasional ini diperlukan sebelum dataset kegiatan asli bersangkutan diterbitkan.

### Kamus untuk tim kegiatan dan pengembang

| Istilah di dokumen | Arti dalam pekerjaan operator |
|---|---|
| Dataset, grain, field | Dataset adalah kumpulan data, misalnya progres SLS. Grain menjelaskan unit satu baris, misalnya satu SLS pada satu tanggal. Field adalah satu unsur data seperti jumlah selesai. |
| Mapping, adapter, schema | Mapping memasangkan kolom sumber dengan indikator. Adapter membaca satu format berkas. Schema menetapkan bentuk dan tipe yang diterima agar “040” sebagai kode kecamatan tetap utuh. |
| Snapshot, rilis, baseline | Snapshot menyimpan kondisi data untuk satu waktu, rilis mencatat data dan tampilan yang diterbitkan bersama, baseline adalah kondisi pembanding, umumnya kemarin. |
| Registry, widget, renderer | Registry adalah katalog komponen beserta aturannya. Widget adalah satu komponen seperti kartu progres. Renderer menggambarkan komponen itu di layar atau pada laporan PNG. |
| API, endpoint, worker, job | API adalah jalur komunikasi antarprogram. Endpoint adalah alamat satu operasi. Worker adalah proses yang mengerjakan tugas berat di belakang layar. Job adalah satu pekerjaan bernomor yang statusnya bisa dilihat operator. |
| Tenant, role, grant | Tenant adalah ruang milik satu organisasi/satker. Role menentukan tugas seseorang. Grant memberi izin khusus, misalnya membaca satu dashboard terbatas. |
| Staging, transaksi, revisi, rollback | Staging adalah tempat uji atau penampungan sementara. Transaksi menerapkan beberapa perubahan sebagai satu kesatuan. Revisi menandai versi. Rollback mengembalikan versi yang pernah diterbitkan. |
| Idempotensi, hash, audit | Idempotensi membuat klik ulang atas permintaan yang sama menghasilkan satu pembaruan. Hash adalah sidik digital untuk mengenali isi berkas. Audit merekam siapa mengubah apa dan kapan. |
| Fixture, uji ujung ke ujung, p95 | Fixture adalah contoh data dengan jawaban yang diketahui. Uji ujung ke ujung mencoba alur nyata dari klik hingga hasil. p95 dua detik berarti sedikitnya 95% pengukuran selesai dalam dua detik. |
| Provider, gateway, token, redeploy | Provider menyediakan akses model, gateway menerima/meneruskan permintaan, token adalah kunci akses, dan redeploy menjalankan kembali layanan dengan konfigurasi yang telah disimpan. |
