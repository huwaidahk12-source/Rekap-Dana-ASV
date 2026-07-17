// 1. Konfigurasi Koneksi Supabase
const supabaseUrl = 'https://pezjsopxdcpjikdquntd.supabase.co';
const supabaseKey = 'sb_publishable_OFOF9d73FqpAucd_Nt1vJQ_EdOAHV_8';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

document.addEventListener('alpine:init', () => {
    Alpine.data('rabApp', () => ({
        // State UI & Default Halaman Diubah Langsung ke 'dashboard'
        currentTab: 'dashboard', 
        isModalOpen: false,
        isReceiptOpen: false,
        modalMode: 'add',
        activeReceipt: '',
        toasts: [],
        chartInstance: null,
        
        // State Fitur Sorting Transaksi Baru
        sortBy: 'modifikasi-terbaru',
        
        // State Data Utama
        transactions: [],
        formData: { id: '', date: '', type: 'masuk', category: '', description: '', quantity: '', amount: '', receipt: '' },

        // Fungsi inisialisasi awal saat aplikasi dimuat
        async init() {
            await this.fetchTransactions();

            // Render grafik saat awal dibuka jika halaman default-nya dashboard
            if (this.currentTab === 'dashboard') {
                setTimeout(() => this.initChart(), 100);
            }

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
                .select('*');
            
            if (error) {
                this.showToast('Gagal mengambil data: ' + error.message, 'error');
            } else {
                this.transactions = data || [];
            }
        },

        // --- LOGIKA UTAMA URUTAN DATA (SORTING GETTER) ---
        get sortedTransactions() {
            return [...this.transactions].sort((a, b) => {
                if (this.sortBy === 'modifikasi-terbaru') {
                    return b.id - a.id; // Diurutkan berdasarkan timestamp pembuatan data terbaru
                }
                if (this.sortBy === 'modifikasi-terlama') {
                    return a.id - b.id; // Urutan modifikasi terlama
                }
                if (this.sortBy === 'tanggal-terbaru') {
                    const tanggalA = new Date(a.date);
                    const tanggalB = new Date(b.date);
                    if (tanggalB - tanggalA !== 0) return tanggalB - tanggalA;
                    return b.id - a.id; // Jika tanggal sama, kembalikan ke inputan terbaru
                }
                if (this.sortBy === 'tanggal-terlama') {
                    const tanggalA = new Date(a.date);
                    const tanggalB = new Date(b.date);
                    if (tanggalA - tanggalB !== 0) return tanggalA - tanggalB;
                    return a.id - b.id;
                }
                return 0;
            });
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
        openModal(mode, item = null) {
            this.modalMode = mode;
            if (mode === 'edit' && item) {
                this.formData = JSON.parse(JSON.stringify(item)); 
            } else {
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
            const payload = {
                id: this.formData.id,
                date: this.formData.date,
                type: this.formData.type,
                description: this.formData.description,
                category: this.formData.category || null,
                amount: parseFloat(this.formData.amount) || 0,
                receipt: this.formData.receipt || null,
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

                const targetIndex = this.transactions.findIndex(t => t.id === this.formData.id);
                if (targetIndex !== -1) {
                    this.transactions[targetIndex] = data[0];
                }
                this.showToast('Transaksi berhasil diperbarui!', 'success');
            }
            
            this.isModalOpen = false;
        },

        // --- HAPUS DATA (DELETE) ---
        async deleteTransaction(id) {
            if (confirm('Apakah Anda yakin ingin menghapus data ini secara permanen dari Cloud database?')) {
                const { error } = await supabaseClient
                    .from('transactions')
                    .delete()
                    .eq('id', id);
                
                if (error) {
                    this.showToast('Gagal menghapus data: ' + error.message, 'error');
                    return;
                }

                const targetIndex = this.transactions.findIndex(t => t.id === id);
                if (targetIndex !== -1) {
                    this.transactions.splice(targetIndex, 1);
                }
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
            
            const barisExcel = [
                ["LAPORAN REKAPITULASI KEUANGAN - ASV FINANCES"], 
                [`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')} | Pukul: ${new Date().toLocaleTimeString('id-ID')}`], 
                [], 
                ["No", "Tanggal", "Jenis Transaksi", "Kategori", "Keterangan / Keperluan", "Jumlah Barang", "Nominal (Rp)"] 
            ];

            // Selalu gunakan data terurut saat di-export agar konsisten dengan tabel di web
            this.sortedTransactions.forEach((t, i) => {
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

            barisExcel.push([]); 
            barisExcel.push(["", "", "", "", "TOTAL PEMASUKAN", "", this.totals.masuk]);
            barisExcel.push(["", "", "", "", "TOTAL PENGELUARAN", "", this.totals.keluar]);
            barisExcel.push(["", "", "", "", "SALDO AKHIR TERSEDIA", "", this.totals.saldo]);

            const ws = XLSX.utils.aoa_to_sheet(barisExcel);

            const lebarKolom = [
                { wch: 6 },   // No
                { wch: 15 },  // Tanggal
                { wch: 18 },  // Jenis Transaksi
                { wch: 16 },  // Kategori
                { wch: 38 },  // Keterangan / Keperluan
                { wch: 14 },  // Jumlah Barang
                { wch: 22 }   // Nominal (Rp)
            ];
            ws['!cols'] = lebarKolom;

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Rekap Finansial");
            
            const timestamp = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `Laporan_Keuangan_ASV_${timestamp}.xlsx`);
            
            this.showToast('Laporan Excel rapi berhasil diunduh!', 'success');
        }
    }));
});
