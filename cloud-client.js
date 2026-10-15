// Public configuration only. Service-role keys must never reach this module.
const BASE = new URL('.', import.meta.url);
const fail = (message, status = 0, code = 'NETWORK_ERROR') => Object.assign(new Error(message), {status,code});

export class CloudClient {
  constructor(config,{fetchImpl=globalThis.fetch,storage=globalThis.sessionStorage}={}) {
    this.config=config;this.fetch=fetchImpl.bind(globalThis);this.storage=storage;this.refreshing=null;this.profile=null;
    const url=new URL(config.url);
    if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw fail('Supabase adresi HTTPS olmalıdır.',400,'CONFIG');
    if(!config.publishableKey||config.publishableKey.startsWith('sb_secret_'))throw fail('Yalnızca herkese açık Supabase anahtarı kullanılabilir.',400,'CONFIG');
    try { if(JSON.parse(atob(config.publishableKey.split('.')[1])).role==='service_role')throw fail('Gizli yönetici anahtarı tarayıcıda kullanılamaz.',400,'CONFIG'); } catch(e){if(e.code==='CONFIG')throw e;}
    this.url=url.origin;this.key=`tensor-cloud-session:${url.hostname}`;
    try {this.session=JSON.parse(storage.getItem(this.key))||null;} catch {this.session=null;}
  }
  save(session){this.session=session;try{if(session)this.storage.setItem(this.key,JSON.stringify(session));else this.storage.removeItem(this.key);}catch{throw fail('Oturum kaydedilemiyor. Tarayıcı depolama iznini kontrol edin.',0,'STORAGE');}}
  async request(path,body,token,method='POST'){
    let response;
    try { response=await this.fetch(this.url+path,{method,headers:{apikey:this.config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)}); }
    catch(error) {console.warn('Cloud connection failed:',error?.name,error?.message);throw fail('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');}
    if(response.status===204)return null;
    let value;try{value=await response.json();}catch{throw fail('Sunucudan geçerli yanıt alınamadı.',response.status>=400?response.status:502,'SERVER_RESPONSE');}
    if(!response.ok){
      if(path.startsWith('/auth/'))throw fail(response.status===429?'Çok fazla giriş denemesi yapıldı. Biraz bekleyip tekrar deneyin.':'Giriş bilgileri doğrulanamadı. Numaranızı ve şifrenizi kontrol edin.',response.status,value.code||'AUTH_ERROR');
      throw fail(value.error?.message||'İşlem tamamlanamadı. Lütfen tekrar deneyin.',response.status,value.error?.code||'API_ERROR');
    }
    return value;
  }
  async login({role,identifier,password}){
    const number=String(identifier).trim();
    if(role==='student'&&!/^\d{6,20}$/.test(number))throw fail('Öğrenci numarası 6–20 rakam olmalıdır.',400,'VALIDATION');
    if(role==='teacher'&&number!=='ogretmen')throw fail('Öğretmen kullanıcı adı: ogretmen',400,'VALIDATION');
    const session=await this.request('/auth/v1/token?grant_type=password',{email:role==='teacher'?'ogretmen@teachers.invalid':`${number}@students.invalid`,password});
    this.save(session);
    try {
      const profile=await this.getProfile();
      if(profile.role!==role)throw fail('Bu hesap seçilen giriş türüne ait değil.',403,'ROLE');
      return profile;
    }catch(e){this.save(null);throw e;}
  }
  async refresh(){
    if(!this.session?.refresh_token)throw fail('Lütfen yeniden giriş yapın.',401,'SESSION_REQUIRED');
    if(!this.refreshing)this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{refresh_token:this.session.refresh_token}).then(s=>{this.save(s);return s;}).catch(e=>{if(e.status===400||e.status===401)this.save(null);throw e;}).finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
  async api(action,payload={}){
    if(!this.session?.access_token)throw fail('Lütfen giriş yapın.',401,'SESSION_REQUIRED');
    if((this.session.expires_at||0)<Date.now()/1000+45)await this.refresh();
    const path=`/functions/v1/${this.config.functionName||'course-api'}`;
    try{return await this.request(path,{...payload,action},this.session.access_token);}
    catch(e){if(e.status!==401)throw e;await this.refresh();return this.request(path,{...payload,action},this.session.access_token);}
  }
  async getProfile(){const {profile}=await this.api('session');this.profile=profile;return profile;}
  async changePassword(password){
    const {profile}=await this.api('change-password',{password});
    // Changing a password revokes previous refresh sessions; sign in afresh.
    this.save(null);
    return this.login({role:profile.role,identifier:profile.role==='teacher'?'ogretmen':profile.number,password});
  }
  bootstrap(token,password){return this.request(`/functions/v1/${this.config.functionName||'course-api'}`,{action:'bootstrap',token,password});}
  async signOut(){try{if(this.session?.access_token)await this.request('/auth/v1/logout',undefined,this.session.access_token);}catch{}finally{this.save(null);this.profile=null;}location.assign(new URL('login.html',BASE));}
}

let cloud;
export async function getCloudClient(){
  if(!cloud)cloud=(async()=>{
    let response;try{response=await fetch(new URL('cloud-config.json',BASE),{cache:'no-store'});}catch{throw fail('Bağlantı ayarları yüklenemedi.');}
    if(!response.ok)throw fail('Supabase bağlantı ayarları bulunamadı.',response.status,'CONFIG');
    const config=await response.json();
    if(config.enabled===false)return null;
    if(config.enabled!==true)throw fail('Supabase bağlantı ayarları geçersiz.',400,'CONFIG');
    return new CloudClient(config);
  })();
  return cloud;
}
export async function requireCloudSession(role){
  const client=await getCloudClient();if(!client)return null;
  let profile;
  try{profile=await client.getProfile();}catch(e){if(e.status===401||e.status===400){location.replace(new URL(`login.html?role=${role}`,BASE));throw fail('Giriş ekranına yönlendiriliyorsunuz.',401,'REDIRECT');}throw e;}
  if(profile.role!==role){location.replace(new URL(profile.role==='teacher'?'teacher/':'./',BASE));throw fail('Hesabınıza uygun ekrana yönlendiriliyorsunuz.',403,'REDIRECT');}
  if(profile.mustChangePassword){location.replace(new URL('change-password.html',BASE));throw fail('İlk girişte şifrenizi değiştirmeniz gerekiyor.',403,'REDIRECT');}
  return {client,profile};
}
