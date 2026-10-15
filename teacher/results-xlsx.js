// Browser-only workbook export; the pinned ExcelJS bundle is loaded on demand.
// Reports are built locally from the authenticated teacher's displayed data.
const HEADER_ROW=7, FIRST_ROW=8;
const FONT='Arial', INK='233C48', ACCENT='215E69', MUTED='617580';
export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const columnName=index=>{let text='';for(let n=index;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;};
const formula=(text,result)=>({formula:text,result:result??''});
const safeText=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,32767);

function sheetName(value,used) {
  let base=safeText(value).replace(/[\\/*?:\[\]]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,31)||'Ödev';
  let name=base,index=2;
  while(used.has(name.toLocaleLowerCase('tr-TR'))){const suffix=` (${index++})`;name=base.slice(0,31-suffix.length)+suffix;}
  used.add(name.toLocaleLowerCase('tr-TR'));return name;
}
function addReportSheet(workbook,name,headers,rows,{title,context,notes,widths}) {
  const sheet=workbook.addWorksheet(name,{
    properties:{tabColor:{argb:ACCENT},defaultRowHeight:22},
    views:[{state:'frozen',xSplit:2,ySplit:HEADER_ROW,topLeftCell:`C${FIRST_ROW}`,activeCell:`C${FIRST_ROW}`,showGridLines:false}],
    pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`1:${HEADER_ROW}`}
  });
  headers.forEach((_,i)=>{sheet.getColumn(i+1).width=widths[i]||15;});
  sheet.getRow(1).height=10;
  const titleCell=sheet.getCell('A2');titleCell.value=safeText(title);titleCell.font={name:FONT,size:15,bold:true,color:{argb:INK}};
  sheet.getRow(2).height=27;
  for(const [offset,value] of [context,...notes].entries()){
    const cell=sheet.getCell(offset+3,1);cell.value=safeText(value);cell.font={name:FONT,size:10,color:{argb:MUTED}};
    sheet.getRow(offset+3).height=19;
  }
  sheet.getRow(6).height=9;
  const header=sheet.getRow(HEADER_ROW);header.values=headers;header.height=34;
  header.eachCell(cell=>{
    cell.font={name:FONT,size:10,bold:true,color:{argb:'FFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:ACCENT}};
    cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    cell.border={right:{style:'thin',color:{argb:'FFFFFF'}}};
  });
  rows.forEach((values,index)=>{
    const row=sheet.getRow(FIRST_ROW+index);
    row.values=values.map(v=>typeof v==='string'?safeText(v):v);
    row.height=24;
    for(let col=1;col<=headers.length;col++){
      const cell=row.getCell(col);cell.font={name:FONT,size:10,color:{argb:INK}};
      cell.alignment={vertical:'middle',horizontal:typeof values[col-1]==='number'?'right':'left'};
      cell.numFmt=col===1?'@':((headers[col-1]==='İçerik sürümü'||headers[col-1]==='Sürüm')?'0':'0.00');
      if(index%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'F1F6F7'}};
    }
    // Student numbers are identifiers, including leading zeros and >15 digits.
    row.getCell(1).value=String(values[0]);row.getCell(1).numFmt='@';
  });
  const lastRow=Math.max(HEADER_ROW,FIRST_ROW+rows.length-1),lastColumn=columnName(headers.length);
  sheet.autoFilter=`A${HEADER_ROW}:${lastColumn}${lastRow}`;
  sheet.pageSetup.printArea=`A1:${lastColumn}${Math.max(FIRST_ROW,lastRow)}`;
  sheet.headerFooter={oddFooter:'&L'+safeText(name).replace(/&/g,'&&')+'&RSayfa &P / &N'};
  if(!rows.length){sheet.getCell(`A${FIRST_ROW}`).value='Bu dönemde öğrenci kaydı yok.';sheet.getCell(`A${FIRST_ROW}`).font={name:FONT,size:10,color:{argb:MUTED}};}
  return sheet;
}

export function createResultsWorkbook(report,ExcelJS) {
  if(!ExcelJS?.Workbook)throw new Error('Excel bileşeni yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
  const workbook=new ExcelJS.Workbook();
  workbook.creator='Tensor Çalışmaları';workbook.subject='Ödev sonuç raporu';
  workbook.created=new Date(report.generatedAt);workbook.modified=new Date(report.generatedAt);
  workbook.calcProperties.fullCalcOnLoad=true;
  const stamp=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'}).format(new Date(report.generatedAt));
  const context=`${report.termName} · ${stamp} (Türkiye saati)`;
  const summary=addReportSheet(workbook,'Genel Bakış',report.summary.headers,report.summary.rows,{
    title:'Ödev sonuçları',context,
    notes:['Onaylı son not; onay yoksa ön puan gösterilir. Ayrıntılar ödev sayfalarındadır.','Boş hücre: gönderim yok. Pasif öğrenciler rapora dahildir.'],
    widths:[24,34,...report.assignments.map(()=>17)]
  });
  const used=new Set(['genel bakış']),sheets=[];
  for(const detail of report.details){
    const name=sheetName(detail.name,used);
    const sheet=addReportSheet(workbook,name,detail.headers,detail.rows,{
      title:`${detail.name} — ${detail.title}`,context,
      notes:['Q1–Q4: en yüksek gönderim puanı. Q5 ve Q6: üçer test maddesinin toplamı.','Toplam ön puandır; öğretmen onaylı son not ayrı sütundadır. Boş hücre: gönderim yok.'],
      widths:[24,34,10,10,10,10,10,12,12,15,16,30,12,17,11,11,11,11,11,11,55]
    });
    detail.rows.forEach((values,index)=>{
      const row=FIRST_ROW+index;
      sheet.getCell(`H${row}`).value=formula(`IF(COUNT(O${row}:Q${row})=0,"",SUM(O${row}:Q${row}))`,values[7]);
      sheet.getCell(`I${row}`).value=formula(`IF(COUNT(R${row}:T${row})=0,"",SUM(R${row}:T${row}))`,values[8]);
      sheet.getCell(`J${row}`).value=formula(`IF(COUNT(D${row}:I${row})=0,"",SUM(D${row}:I${row}))`,values[9]);
      for(const col of ['H','I','J','K']){
        const cell=sheet.getCell(`${col}${row}`);cell.alignment={horizontal:'right',vertical:'middle'};
        if(col==='J'||col==='K')cell.font={name:FONT,size:10,bold:true,color:{argb:INK}};
      }
      // Fit unusually long names/status/notes without hiding any text.
      for(const col of [2,12,21])sheet.getCell(row,col).alignment={wrapText:true,vertical:'middle'};
      const lines=Math.max(1,...[1,11,20].map(i=>Math.ceil(safeText(values[i]).length/(i===20?55:i===11?30:34))));
      sheet.getRow(row).height=Math.max(24,Math.min(409,lines*14+8));
    });
    sheets.push(sheet);
  }
  // Match immutable student numbers so sorting a detail sheet cannot cross-wire grades.
  // COUNT on an INDEX reference distinguishes an empty final mark from a real zero.
  summary.eachRow((row,rowNumber)=>{
    if(rowNumber<FIRST_ROW||rowNumber>=FIRST_ROW+report.students.length)return;
    sheets.forEach((sheet,index)=>{
      const quoted=`'${sheet.name.replace(/'/g,"''")}'`,end=FIRST_ROW+report.students.length-1;
      const match=`MATCH($A${rowNumber},${quoted}!$A$${FIRST_ROW}:$A$${end},0)`;
      const final=`INDEX(${quoted}!$K$${FIRST_ROW}:$K$${end},${match})`,total=`INDEX(${quoted}!$J$${FIRST_ROW}:$J$${end},${match})`;
      const cell=row.getCell(index+3);
      cell.value=formula(`IF(COUNT(${final})>0,${final},IF(COUNT(${total})>0,${total},""))`,report.summary.rows[rowNumber-FIRST_ROW][index+2]);
      cell.alignment={horizontal:'right',vertical:'middle'};
    });
    row.getCell(2).alignment={wrapText:true,vertical:'middle'};
    row.height=Math.max(24,Math.ceil(safeText(row.getCell(2).value).length/34)*14+8);
  });
  return workbook;
}

export async function downloadResultsWorkbook(report,termId) {
  const module=await import('./exceljs.min.js');
  const ExcelJS=module.default||globalThis.ExcelJS;
  const workbook=createResultsWorkbook(report,ExcelJS);
  const bytes=await workbook.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([bytes],{type:XLSX_MIME}));
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=`tensor-sonuclar-${String(termId).replace(/[^a-zA-Z0-9_-]/g,'-')}.xlsx`;
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
}
