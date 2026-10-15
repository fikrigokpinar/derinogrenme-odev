// Fixed category IDs keep historical feedback meaningful when labels change.
export const FEEDBACK_STATUSES=Object.freeze({new:'Yeni',reviewing:'İnceleniyor',resolved:'Tamamlandı'});
const categories=[
  ['question','Soru hakkında','Bir soru veya madde hakkında geri bildirim.',true],
  ['technical','Teknik sorun','Çalıştırma, bağlantı veya uygulama sorunu.',false],
  ['usability','Kullanım kolaylığı','Arayüz ve kullanım deneyimi hakkında.',false],
  ['content','Ders içeriği','Dersin kapsamı ve açıklamalar hakkında.',false],
  ['suggestion','Öneri / yapısal değişiklik','Ders veya uygulama için geliştirme önerisi.',false],
  ['other','Diğer','Diğer görüş ve geri bildirimler.',false]
];
export function feedbackSettings(value){
  return {revision:Number.isInteger(value?.revision)&&value.revision>=0?value.revision:0,enabled:value?.enabled!==false,categories:categories.map(([id,label,description,requiresQuestion])=>{
    const item=Array.isArray(value?.categories)?value.categories.find(c=>c?.id===id):null;
    return {id,label:typeof item?.label==='string'&&item.label.trim()?item.label.trim():label,description:typeof item?.description==='string'?item.description:description,enabled:item?.enabled!==false,requiresQuestion:typeof item?.requiresQuestion==='boolean'?item.requiresQuestion:requiresQuestion};
  })};
}
export function validateFeedbackSettings(value){
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  check(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.enabled==='boolean','Geri bildirim ayarları geçersiz.');
  check(Array.isArray(value.categories)&&value.categories.length===categories.length,'Tüm geri bildirim kategorileri korunmalıdır.');
  const ids=new Set();
  for(const item of value.categories){
    check(item&&categories.some(([id])=>id===item.id)&&!ids.has(item.id),'Kategori kimliği geçersiz veya tekrarlanmış.');ids.add(item.id);
    check(typeof item.label==='string'&&item.label.trim().length>=1&&item.label.length<=100&&!/[\x00-\x1f]/.test(item.label),'Kategori adı 1–100 karakter olmalıdır.');
    check(typeof item.description==='string'&&item.description.length<=500&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.description),'Kategori açıklaması en fazla 500 karakter olmalıdır.');
    check(typeof item.enabled==='boolean'&&typeof item.requiresQuestion==='boolean','Kategori ayarları geçersiz.');
  }
  return feedbackSettings(value);
}
