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
                // REVISI OKSIONAL: Jika kolom jumlah diisi maka jadikan angka, jika kosong kirim null
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

        // --- EXPORT LAPORAN EXCEL ---
        exportToExcel() {
            if (this.transactions.length === 0) {
                this.showToast('Tidak ada data transaksi untuk di-export', 'error');
                return;
            }
            
            const excelData = this.transactions.map((t, i) => ({
                'No': i + 1,
                'Tanggal': this.formatDate(t.date),
                'Jenis Transaksi': t.type === 'masuk' ? 'Pemasukan' : 'Pengeluaran',
                'Kategori': t.category || '-',
                'Keterangan / Keperluan': t.description,
                'Jumlah Barang': t.quantity || '-', 
                'Nominal (Rp)': parseFloat(t.amount)
            }));

            const ws = XLSX.utils.json_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Rekap Keuangan");
            XLSX.writeFile(wb, `Data_Keuangan_ASV_${new Date().getTime()}.xlsx`);
            
            this.showToast('Laporan Excel berhasil diunduh!', 'success');
        }
    }));
});
