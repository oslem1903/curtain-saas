import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

async function createPayrollSystem() {
  const workbook = new ExcelJS.Workbook();
  workbook.removeWorksheet(workbook.worksheets[0]);

  // ========== AYLAR SAYFASI ==========
  const aylarSheet = workbook.addWorksheet('Aylar', { hidden: true });
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  aylar.forEach((ay, idx) => {
    aylarSheet.getCell(`A${idx + 1}`).value = ay;
  });

  // ========== YILLAR SAYFASI ==========
  const yillarSheet = workbook.addWorksheet('Yıllar', { hidden: true });
  for (let y = 2023; y <= 2027; y++) {
    yillarSheet.getCell(`A${y - 2022}`).value = y;
  }

  // ========== FİRMALAR SAYFASI ==========
  const firmaSheet = workbook.addWorksheet('Firmalar');
  firmaSheet.columns = [
    { header: 'Firma ID', key: 'id', width: 12 },
    { header: 'Firma Adı', key: 'name', width: 20 },
    { header: 'Yetkili Kişi', key: 'contact', width: 18 },
    { header: 'Telefon', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 22 },
    { header: 'Adres', key: 'address', width: 30 }
  ];

  // Başlık stili
  const headerStyle = {
    font: { bold: true, color: { argb: 'FFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
  };

  firmaSheet.getRow(1).eachCell(cell => { cell.style = headerStyle; });
  firmaSheet.getRow(1).height = 20;

  // Örnek firma verileri
  const firmalar = [
    { id: 1, name: 'Firma A', contact: 'Ali Özdemir', phone: '0555-123-4567', email: 'ali@firmaA.com', address: 'İstanbul' },
    { id: 2, name: 'Firma B', contact: 'Zeynep Yıldız', phone: '0555-987-6543', email: 'zeynep@firmaB.com', address: 'Ankara' },
    { id: 3, name: 'Firma C', contact: 'Murat Şahin', phone: '0555-555-5555', email: 'murat@firmaC.com', address: 'İzmir' }
  ];

  firmalar.forEach(firma => {
    const row = firmaSheet.addRow(firma);
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'left', vertical: 'center' };
    });
  });

  // ========== PERSONEL LİSTESİ SAYFASI ==========
  const personelSheet = workbook.addWorksheet('Personel Listesi');
  personelSheet.columns = [
    { header: 'Personel ID', key: 'id', width: 12 },
    { header: 'Adı Soyadı', key: 'name', width: 16 },
    { header: 'Firma', key: 'firma', width: 14 },
    { header: 'Pozisyon', key: 'position', width: 14 },
    { header: 'Departman', key: 'department', width: 14 },
    { header: 'Maaşı (TL)', key: 'salary', width: 12 },
    { header: 'İşe Giriş', key: 'startDate', width: 12 },
    { header: 'Kimlik No', key: 'idNo', width: 14 },
    { header: 'Telefon', key: 'phone', width: 14 },
    { header: 'Email', key: 'email', width: 18 },
    { header: 'Durum', key: 'status', width: 10 }
  ];

  personelSheet.getRow(1).eachCell(cell => { cell.style = headerStyle; });
  personelSheet.getRow(1).height = 20;

  const personeller = [
    { id: 1, name: 'Ahmet YILMAZ', firma: 'Firma A', position: 'Operatör', department: 'Üretim', salary: 5000, startDate: '01.01.2023', idNo: '12345678901', phone: '0555-111-1111', email: 'ahmet@mail.com', status: 'Aktif' },
    { id: 2, name: 'Fatma ŞAHİN', firma: 'Firma A', position: 'Memur', department: 'Yönetim', salary: 4500, startDate: '15.03.2023', idNo: '98765432101', phone: '0555-222-2222', email: 'fatma@mail.com', status: 'Aktif' },
    { id: 3, name: 'Mehmet KAYA', firma: 'Firma B', position: 'Şef', department: 'Üretim', salary: 6000, startDate: '20.02.2023', idNo: '55555555555', phone: '0555-333-3333', email: 'mehmet@mail.com', status: 'Aktif' },
    { id: 4, name: 'Ayşe DEMIR', firma: 'Firma B', position: 'Mühendis', department: 'Teknik', salary: 7000, startDate: '10.01.2023', idNo: '11111111111', phone: '0555-444-4444', email: 'ayse@mail.com', status: 'Aktif' },
    { id: 5, name: 'Hüseyin GÜL', firma: 'Firma C', position: 'Koordinatör', department: 'Lojistik', salary: 5500, startDate: '05.04.2023', idNo: '22222222222', phone: '0555-555-5555', email: 'huseyin@mail.com', status: 'Aktif' }
  ];

  personeller.forEach(personel => {
    const row = personelSheet.addRow(personel);
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'left', vertical: 'center' };
    });
  });

  // Salary sütunu para birimi
  personelSheet.getColumn('salary').numFmt = '#,##0 "₺"';

  // ========== ANA SAYFA (DASHBOARD) ==========
  const dashboardSheet = workbook.addWorksheet('Ana Sayfa', { views: [{ state: 'frozen', ySplit: 8 }] });
  dashboardSheet.pageSetup = {
    paperSize: 'A4',
    orientation: 'landscape',
    margins: {
      left: 0.7,
      right: 0.7,
      top: 0.75,
      bottom: 0.75,
      header: 0.3,
      footer: 0.3
    }
  };

  // Başlık
  dashboardSheet.mergeCells('A1:N1');
  const titleCell = dashboardSheet.getCell('A1');
  titleCell.value = 'PERSONEL PUANTAJ YÖNETİM SİSTEMİ';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'center' };
  dashboardSheet.getRow(1).height = 28;

  // Filtre alanları
  const filterLabelStyle = {
    font: { bold: true, size: 11 },
    alignment: { horizontal: 'right', vertical: 'center' }
  };

  const filterInputStyle = {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF00' } },
    border: {
      top: { style: 'medium' },
      left: { style: 'medium' },
      bottom: { style: 'medium' },
      right: { style: 'medium' }
    },
    alignment: { horizontal: 'center', vertical: 'center' }
  };

  // Boş satır
  dashboardSheet.getRow(2).height = 8;

  // AY SEÇ
  dashboardSheet.getCell('A3').value = '📅 AY SEÇ:';
  dashboardSheet.getCell('A3').style = filterLabelStyle;
  dashboardSheet.getCell('B3').style = filterInputStyle;
  dashboardSheet.getCell('B3').dataValidation = {
    type: 'list',
    formula1: 'Aylar!$A$1:$A$12',
    showErrorMessage: true,
    errorTitle: 'Uyarı',
    error: 'Lütfen listeden bir ay seçin'
  };

  // FİRMA SEÇ
  dashboardSheet.getCell('A4').value = '🏢 FİRMA SEÇ:';
  dashboardSheet.getCell('A4').style = filterLabelStyle;
  dashboardSheet.getCell('B4').style = filterInputStyle;
  dashboardSheet.getCell('B4').dataValidation = {
    type: 'list',
    formula1: 'Firmalar!$B$2:$B$100',
    showErrorMessage: true,
    errorTitle: 'Uyarı',
    error: 'Lütfen listeden bir firma seçin'
  };

  // YIL SEÇ
  dashboardSheet.getCell('A5').value = '📊 YIL SEÇ:';
  dashboardSheet.getCell('A5').style = filterLabelStyle;
  dashboardSheet.getCell('B5').style = filterInputStyle;
  dashboardSheet.getCell('B5').dataValidation = {
    type: 'list',
    formula1: 'Yıllar!$A$1:$A$5',
    showErrorMessage: true,
    errorTitle: 'Uyarı',
    error: 'Lütfen listeden bir yıl seçin'
  };

  // Boş satır
  dashboardSheet.getRow(6).height = 8;

  // Puantaj tablosu başlığı
  dashboardSheet.getCell('A7').value = '📋 SEÇİLEN DÖNEM PUANTAJ LİSTESİ:';
  dashboardSheet.getCell('A7').font = { bold: true, size: 12, color: { argb: '1F4E78' } };

  // Puantaj tablosu başlıkları
  const puantajHeaders = [
    'Personel Adı', 'Pozisyon', 'Maaş', 'İşe Giriş',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'
  ];

  puantajHeaders.forEach((header, idx) => {
    const cell = dashboardSheet.getCell(8, idx + 1);
    cell.value = header;
    cell.style = {
      font: { bold: true, color: { argb: 'FFFFFF' }, size: 10 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '366092' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    };
  });

  dashboardSheet.getRow(8).height = 20;

  // Örnek satırlar (20 satır boş bırak)
  for (let i = 9; i <= 28; i++) {
    for (let j = 1; j <= puantajHeaders.length; j++) {
      const cell = dashboardSheet.getCell(i, j);
      cell.border = {
        top: { style: 'thin', color: { argb: 'D3D3D3' } },
        left: { style: 'thin', color: { argb: 'D3D3D3' } },
        bottom: { style: 'thin', color: { argb: 'D3D3D3' } },
        right: { style: 'thin', color: { argb: 'D3D3D3' } }
      };
    }
  }

  // Kolon genişlikleri
  dashboardSheet.getColumn('A').width = 16;
  dashboardSheet.getColumn('B').width = 14;
  dashboardSheet.getColumn('C').width = 12;
  dashboardSheet.getColumn('D').width = 12;
  for (let i = 5; i <= puantajHeaders.length; i++) {
    dashboardSheet.getColumn(i).width = 8;
  }

  // ========== PUANTAJ KAYDII SAYFASI ==========
  const puantajSheet = workbook.addWorksheet('Puantaj Kaydı');

  // Başlık
  puantajSheet.mergeCells('A1:F1');
  const puantajTitle = puantajSheet.getCell('A1');
  puantajTitle.value = 'AYLIK PUANTAJ KAYDII';
  puantajTitle.font = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
  puantajTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
  puantajTitle.alignment = { horizontal: 'center', vertical: 'center' };
  puantajSheet.getRow(1).height = 24;

  // Boş satır
  puantajSheet.getRow(2).height = 6;

  // Bilgi alanları
  const infoStyle = {
    font: { bold: true },
    alignment: { horizontal: 'right', vertical: 'center' }
  };

  const infoInputStyle = {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F4F8' } },
    border: {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    },
    alignment: { horizontal: 'center', vertical: 'center' }
  };

  puantajSheet.getCell('A3').value = 'Firma:';
  puantajSheet.getCell('A3').style = infoStyle;
  puantajSheet.getCell('B3').style = infoInputStyle;

  puantajSheet.getCell('A4').value = 'Ay:';
  puantajSheet.getCell('A4').style = infoStyle;
  puantajSheet.getCell('B4').style = infoInputStyle;

  puantajSheet.getCell('A5').value = 'Yıl:';
  puantajSheet.getCell('A5').style = infoStyle;
  puantajSheet.getCell('B5').style = infoInputStyle;

  // Boş satır
  puantajSheet.getRow(6).height = 6;

  // Puantaj tablosu
  puantajSheet.columns = [
    { header: 'Gün', key: 'day', width: 8 },
    { header: 'Personel Adı', key: 'personel', width: 18 },
    { header: 'Giriş Saati', key: 'entry', width: 12 },
    { header: 'Çıkış Saati', key: 'exit', width: 12 },
    { header: 'Çalışma Saati', key: 'hours', width: 12 },
    { header: 'Notlar', key: 'notes', width: 20 }
  ];

  puantajSheet.getRow(7).eachCell(cell => { cell.style = headerStyle; });
  puantajSheet.getRow(7).height = 20;

  // 31 gün için satırlar
  for (let day = 1; day <= 31; day++) {
    const row = puantajSheet.addRow({
      day: day,
      personel: '',
      entry: '',
      exit: '',
      hours: '',
      notes: ''
    });
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'center' };
    });
  }

  // ========== HESAPLAMALAR SAYFASI (GİZLİ) ==========
  const calcSheet = workbook.addWorksheet('Hesaplamalar', { hidden: true });

  calcSheet.columns = [
    { header: 'Personel ID', key: 'id', width: 12 },
    { header: 'Adı Soyadı', key: 'name', width: 16 },
    { header: 'Firma', key: 'firma', width: 14 },
    { header: 'Aylık Maaş', key: 'salary', width: 12 },
    { header: 'İşe Giriş Tarihi', key: 'startDate', width: 15 },
    { header: 'Çalışılan Gün', key: 'workDays', width: 12 },
    { header: 'İzin Günü', key: 'leaveDays', width: 12 },
    { header: 'Güne Ait Ücret', key: 'dailyRate', width: 12 },
    { header: 'Ödenmesi Gereken', key: 'amount', width: 12 }
  ];

  calcSheet.getRow(1).eachCell(cell => { cell.style = headerStyle; });
  calcSheet.getRow(1).height = 20;

  personeller.forEach(personel => {
    const row = calcSheet.addRow({
      id: personel.id,
      name: personel.name,
      firma: personel.firma,
      salary: personel.salary,
      startDate: personel.startDate,
      workDays: 0,
      leaveDays: 0,
      dailyRate: `=${personel.salary}/30`,
      amount: '=D2*F2'
    });
  });

  // ========== AYARLAR SAYFASI ==========
  const settingsSheet = workbook.addWorksheet('Ayarlar', { hidden: true });

  settingsSheet.columns = [
    { header: 'Parametre', key: 'param', width: 25 },
    { header: 'Değer', key: 'value', width: 20 }
  ];

  const settings = [
    { param: 'Minimum Ücret (2023)', value: 8506.92 },
    { param: 'Vergili Gün Sayısı', value: 30 },
    { param: 'Yıllık İzin Günü', value: 14 },
    { param: 'Sosyal Sigorta Oranı', value: 0.05 },
    { param: 'Gelir Vergisi Oranı', value: 0.15 },
    { param: 'Vergi Dişi Gün Sayısı', value: 10 }
  ];

  settings.forEach(setting => {
    settingsSheet.addRow(setting);
  });

  // Dosyayı kaydet
  const filePath = 'C:\\Users\\ofis\\Desktop\\MAAŞ HESAP.xlsx';
  await workbook.xlsx.writeFile(filePath);
  console.log(`✅ Excel dosyası başarıyla oluşturuldu: ${filePath}`);
}

createPayrollSystem().catch(console.error);
