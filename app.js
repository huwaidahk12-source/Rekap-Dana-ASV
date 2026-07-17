// 1. Konfigurasi Koneksi Supabase
const supabaseUrl = 'https://pezjsopxdcpjikdquntd.supabase.co';
const supabaseKey = 'sb_publishable_OFOF9d73FqpAucd_Nt1vJQ_EdOAHV_8';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

document.addEventListener('alpine:init', () => {
    Alpine.data('rabApp', () => ({
        // State UI / Navigasi
        currentTab: 'transactions', 
        isModalOpen: false,
        isReceiptOpen: false,
        modalMode: 'add',
        editIndex: null,
        activeReceipt: '',
        toasts: [],
        chartInstance: null,
        
        // State Data Utama
        transactions: [],
        formData: { id: '', date: '', type: 'masuk', category: '', description: '', quantity: '', amount: '', receipt: '' },

        // Fungsi inisialisasi awal saat aplikasi dimuat
        async init() {
            await this.fetchTransactions();

            this.$watch('transactions', () => {
                if(this.currentTab === 'dashboard') this.updateChart();
            });
            this.$watch('currentTab', (val) => {
                if(val === 'dashboard') setTimeout(() => this.initChart(), 100);
            });
        },

        // --- AMBIL DATA (READ) ---
        async fetchTransactions() {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .order('id', { ascending: false }); // Urutkan dari yang paling baru
            
            if (error) {
                this.showToast('Gagal mengambil data: ' + error.message, 'error');
            } else {
                this.transactions = data || [];
            }
        },

        // --- HITUNGAN & FORMATTER ---
        get totals() {
            let masuk = this.transactions.filter(t => t.type === 'masuk').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
            let keluar = this.transactions.filter(t => t.type === 'keluar').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
            return { masuk, keluar, saldo: masuk - keluar };
        },

        formatRupiah(num) {
            return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
        },

        formatDate(dateString) {
            const options = { day: 'numeric', month: 'short', year: 'numeric' };
            return new Date(dateString).toLocaleDateString('id-ID', options);
        },

        // --- MANAGEMENT MODAL & INPUT ---
        openModal(mode, item = null, index = null) {
            this.modalMode = mode;
            if (mode === 'edit' && item) {
                this.editIndex = index;
                this.formData = JSON.parse(JSON.stringify(item)); 
            } else {
                // Saat tambah baru, Jumlah (quantity) dikosongkan agar opsional
                this.formData = { 
                    id: Date.now(), 
                    date: new Date().toISOString().split('T')[0], 
                    type: 'keluar', 
                    category: '', 
                    description: '', 
                    quantity: '', 
                    amount: '', 
                    receipt: '' 
                };
            }
            this.isModalOpen = true;
        },

        handleFileUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            if (file.size > 2 * 1024 * 1024) {
                this.showToast('Ukuran gambar maksimal 2MB!', 'error');
                e.target.value = ''; 
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                this.formData.receipt = event.target.result; 
            };
            reader.readAsDataURL(file);
        },

        // --- SIMPAN DATA (CREATE & UPDATE) ---
        async saveTransaction() {
            // Pembersihan data sebelum dikirim ke Supabase
            const payload = {
                id: this.formData.id,
                date: this.formData.date,
                type: this.formData.type,
                description: this.formData.description,
                category: this.formData.category || null,
                amount: parseFloat(this.formData.amount) || 0,
                receipt: this.formData.receipt || null,
                // Jika kolom jumlah diisi maka jadikan angka, jika kosong kirim null (agar database aman dari error)
                quantity: this.formData.quantity ? parseInt(this.formData.quantity) : null 
            };

            if (this.modalMode === 'add') {
                const { data, error } = await supabaseClient
                    .from('transactions')
                    .insert([payload])
                    .select();
                
                if (error) {
                    this.showToast('Gagal menyimpan ke cloud: ' + error.message, 'error');
                    return;
                }
                
                this.transactions.unshift(data[0]); 
                this.showToast('Transaksi baru berhasil disimpan!', 'success');

            } else if (this.modalMode === 'edit') {
                const { data, error } = await supabaseClient
                    .from('transactions')
                    .update(payload)
                    .eq('id', this.formData.id)
                    .select();
                
                if (error) {
                    this.showToast('Gagal memperbarui data: ' + error.message, 'error');
                    return;
                }

                this.transactions[this.editIndex] = data[0];
                this.showToast('Transaksi berhasil diperbarui!', 'success');
            }
            
            this.isModalOpen = false;
        },

        // --- HAPUS DATA (DELETE) ---
        async deleteTransaction(index) {
            if (confirm('Apakah Anda yakin ingin menghapus data ini secara permanen dari Cloud database?')) {
                const itemID = this.transactions[index].id;
                
                const { error } = await supabaseClient
                    .from('transactions')
                    .delete()
                    .eq('id', itemID);
                
                if (error) {
                    this.showToast('Gagal menghapus data: ' + error.message, 'error');
                    return;
                }

                this.transactions.splice(index, 1);
                this.showToast('Data berhasil dihapus!', 'success');
            }
        },

        // --- UTILITIES & TOAST ---
        viewReceipt(base64) {
            this.activeReceipt = base64;
            this.isReceiptOpen = true;
        },

        showToast(message, type = 'success') {
            const id = Date.now();
            this.toasts.push({ id, message, type });
            setTimeout(() => {
                this.toasts = this.toasts.filter(t => t.id !== id);
            }, 3000);
        },

        // --- GRAFIK (CHART.JS) ---
        initChart() {
            const canvas = document.getElementById('rabChart');
            if (!canvas) return;
            
            if (this.chartInstance) {
                this.chartInstance.destroy(); 
            }

            const ctx = canvas.getContext('2d');
            this.chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Pemasukan', 'Pengeluaran'],
                    datasets: [{
                        data: [this.totals.masuk, this.totals.keluar],
                        backgroundColor: ['#10b981', '#f43f5e'], 
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } } 
                    },
                    cutout: '70%'
                }
            });
        },

        updateChart() {
            if (this.chartInstance) {
                this.chartInstance.data.datasets[0].data = [this.totals.masuk, this.totals.keluar];
                this.chartInstance.update();
            }
        },

        // --- EXPORT LAPORAN EXCEL SUPER RAPI ---
        exportToExcel() {
            if (this.transactions.length === 0) {
                this.showToast('Tidak ada data transaksi untuk di-export', 'error');
                return;
            }
            
            // 1. Susunan Baris Excel (Sistem Array of Arrays)
            const barisExcel = [
                ["LAPORAN REKAPITULASI KEUANGAN - ASV FINANCES"], 
                [`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')} | Pukul: ${new Date().toLocaleTimeString('id-ID')}`], 
                [], 
                ["No", "Tanggal", "Jenis Transaksi", "Kategori", "Keterangan / Keperluan", "Jumlah Barang", "Nominal (Rp)"] 
            ];

            // 2. Masukkan Seluruh Data Transaksi dari Supabase ke Baris Tabel
            this.transactions.forEach((t, i) => {
                barisExcel.push([
                    i + 1,
                    this.formatDate(t.date),
                    t.type === 'masuk' ? 'Pemasukan' : 'Pengeluaran',
                    t.category || '-',
                    t.description,
                    t.quantity || '-', 
                    parseFloat(t.amount)
                ]);
            });

            // 3. Menambahkan Baris Ringkasan Total Otomatis di Paling Bawah
            barisExcel.push([]); 
            barisExcel.push(["", "", "", "", "TOTAL PEMASUKAN", "", this.totals.masuk]);
            barisExcel.push(["", "", "", "", "TOTAL PENGELUARAN", "", this.totals.keluar]);
            barisExcel.push(["", "", "", "", "SALDO AKHIR TERSEDIA", "", this.totals.saldo]);

            // 4. Konversi Data Menjadi Worksheet Excel
            const ws = XLSX.utils.aoa_to_sheet(barisExcel);

            // 5. ATUR LEBAR KOLOM OTOMATIS (Autofit) agar tidak terpotong (###)
            const lebarKolom = [
                { wch: 6 },   // Kolom No
                { wch: 15 },  // Kolom Tanggal
                { wch: 18 },  // Kolom Jenis Transaksi
                { wch: 16 },  // Kolom Kategori
                { wch: 38 },  // Kolom Keterangan / Keperluan
                { wch: 14 },  // Kolom Jumlah Barang
                { wch: 22 }   // Kolom Nominal (Rp)
            ];
            ws['!cols'] = lebarKolom;

            // 6. Satukan ke Workbook dan Jalankan Unduhan
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Rekap Finansial");
            
            const timestamp = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `Laporan_Keuangan_ASV_${timestamp}.xlsx`);
            
            this.showToast('Laporan Excel rapi berhasil diunduh!', 'success');
        }
    }));
});
