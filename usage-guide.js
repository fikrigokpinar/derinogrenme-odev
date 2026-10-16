export const DEFAULT_STUDENT_GUIDE = {
  "title": "Kullanım kılavuzu",
  "subtitle": "Nasıl çözülür, kaç hak var, son tarih geçerse ne olur?",
  "highlights": [
    {
      "title": "{kod_hakki} hak",
      "text": "Her kod sorusu için"
    },
    {
      "title": "{test_hakki} hak",
      "text": "Her test maddesi için"
    },
    {
      "title": "Türkiye saati",
      "text": "Tüm son gönderim tarihleri"
    }
  ],
  "sections": [
    {
      "id": "start",
      "title": "Çalışmaya başla",
      "body": "Sana atanmış aktif çalışma otomatik açılır. Birden fazla aktif çalışma varsa başlıklarından geçiş yapabilirsin. Soruyu, istenen değişken adlarını ve puanını oku; soru menüsü veya Önceki / Sonraki soru düğmeleriyle ilerle.\n\nAktif çalışma yoksa “Şu anda aktif ödeviniz yok” mesajını görürsün. Soruların görünmesi için öğretmeninin ödevi açması gerekir.\n\nÖğretmenin çözümleri yayımladığında “Yayımlanan çözümler” bölümünü aktif ödev olmasa da açabilirsin. Bu bölüm yalnız sana atanmış ödev formunun çözümlerini içerir.",
      "tone": "normal"
    },
    {
      "id": "code",
      "title": "Kod soruları: {kod_hakki} gönderim hakkı",
      "body": "Çözümünü kod alanına yaz. Kodu çalıştır düğmesiyle ödev açıkken sınırsız deneme yapabilirsin; bu işlem puan vermez ve gönderim hakkını azaltmaz. İlk çalıştırmada Python ortamının yüklenmesini bekle.\n\nHazır olduğunda Değerlendirmeye gönder düğmesine bas. Genel olarak her kod sorusunda {kod_hakki} gönderim hakkın vardır; gönderimlerin en yüksek puanı geçerlidir. Gönderilen kodun hata vermesi de bir hak kullanır. Kalan hakkı düğmelerin yanında görürsün.\n\nOrtam yükleme hatası ve iptal edilen çalışma hak kullanmaz. Hakların bittiğinde tekrar değerlendirmeye gönderemezsin; ödev açık olduğu sürece kodunu çalıştırabilirsin. Editörde kopyala/yapıştır öğretmen tarafından sınırlandırılmış olabilir.",
      "tone": "normal"
    },
    {
      "id": "choice",
      "title": "Test soruları: {test_hakki} gönderim hakkı",
      "body": "Her test maddesi için bir seçenek işaretle ve son onaydan önce kontrol et. Yalnızca işaretlemek yanıtı göndermez; bu aşamada seçimini değiştirebilirsin.\n\nGenel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra kaydın ve kalan hakkın gösterilir. Toplam ödev puanın yalnız öğretmenin notları yayımladığında görünür; tüm soruları göndermek notları otomatik açmaz. Soru bazında puan veya doğru / yanlış bilgisi gösterilmez; öğretmen çözümleri yayımlayana kadar doğru seçenek ve çözüm gösterilmez.",
      "tone": "normal"
    },
    {
      "id": "deadline",
      "title": "Son tarih ve geç gönderim",
      "body": "Aktif çalışmanın üstünde son gönderim tarihini ve kalan gün, saat, dakika, saniyeyi görürsün. Tarihler Türkiye saatine göredir. Sana kişisel bir son tarih tanımlandıysa ekranda o tarih gösterilir. Son tarih belirtilmemişse sayaç gösterilmez; öğretmenin ödevi ayrıca kapatabilir.\n\nSüre dolunca yeni yanıt gönderilemez; geç gönderim kabul edilmez. Otomatik ek süre verilmez. Gönderimin son tarihten önce kaydedilmiş olması gerekir; son saniyeyi bekleme. Daha önce kaydedilen yanıtların ve puanların korunur.\n\nEk süre gerekiyorsa öğretmeninle iletişime geç. Öğretmenin süreyi uzatıp ödevi yeniden açarsa kalan haklarınla devam edebilirsin; kullanılan haklar kendiliğinden yenilenmez.",
      "tone": "deadline"
    },
    {
      "id": "save",
      "title": "Kaydı ve bağlantıyı kontrol et",
      "body": "Taslak, gönderilmiş yanıt değildir. Kodunu yazmak, çalıştırmak veya bir seçenek işaretlemek değerlendirme için yeterli değildir. Her soruyu kendi gönderim düğmesiyle gönder; ödevin tamamı için ayrıca bir gönderim düğmesi yoktur.\n\nGönderimden sonra kaydedildi mesajını ve tamamlanan soru sayısını kontrol et. Notlar öğretmenin yayımladığında görünür. Bağlantı veya kayıt hatası varsa işlemi tamamlanmış sayma. Ekrandaki yeniden deneme düğmesini kullan; kaydedilmemiş çalışman varsa sayfayı yenilemeden önce Sonuçları indir ile bir kopyasını sakla. İndirdiğin dosya gönderim yerine geçmez.",
      "tone": "normal"
    },
    {
      "id": "results",
      "title": "Sonuçlarını takip et",
      "body": "Gönderimlerden sonra kaydedildi mesajını, tamamlanan soru sayısını ve kalan haklarını görürsün. “Tamamlanan”, en az bir kez yanıt gönderdiğin maddeleri sayar. Tüm soruları göndermek veya sürenin dolması notları otomatik açmaz. Her sorunun puanı, doğru / yanlış bilgisi ve değerlendirme kontrolleri gösterilmez.\n\nKişisel ek süreler dahil tüm öğrencilerin gönderim süreleri sona erdikten sonra öğretmenin notları ve çözümleri ayrı ayrı yayımlayabilir. Notlar yayımlandığında bu sayfada “Bildirimler” ve “Yayımlanan notlar” bölümlerini görürsün; yalnız kendi toplam ödev notun açılır; öğretmenin son notu onayladıysa bu not gösterilir. Çözümler ayrıca yayımlandığında doğru yanıtları ve açıklamaları “Yayımlanan çözümler” bölümünde görürsün. Bu bölümler aktif ödev olmasa da erişilebilirdir. Ödev yeniden açılırsa veya yayımlama geri alınırsa ilgili içerik ve bildirimi tekrar gizlenir.\n\nKod sorularının en yüksek puanları ve test puanları toplanır. Son not öğretmen onayına bağlıdır. Öğretmeninin not açıklaması, notlar ve çözümler yayımlanmışsa görünür. Sorularda derste doğrudan gösterilmemiş işlemler bulunabilir; ders notları ve resmî dokümantasyon gibi kaynaklardan araştırma yapman beklenir. Şifreni unutursan sıfırlama için öğretmenine başvur.",
      "tone": "normal"
    }
  ]
};

const LEGACY_DEFAULT_SECTIONS = {
  "code": {
    "title": "Kod soruları: 2 gönderim hakkı",
    "body": [
      "Çözümünü kod alanına yaz. Kodu çalıştır düğmesiyle ödev açıkken sınırsız deneme yapabilirsin; bu işlem puan vermez ve gönderim hakkını azaltmaz. İlk çalıştırmada Python ortamının yüklenmesini bekle.",
      "Hazır olduğunda Değerlendirmeye gönder düğmesine bas. Her kod sorusunda iki hakkın vardır ve iki gönderimin yüksek puanı geçerlidir. Gönderilen kodun hata vermesi de bir hak kullanır. Kalan hakkı düğmelerin yanında görürsün.",
      "Ortam yükleme hatası ve iptal edilen çalışma hak kullanmaz. İki hak bittiğinde tekrar değerlendirmeye gönderemezsin; ödev açık olduğu sürece kodunu çalıştırabilirsin. Editörde kopyala/yapıştır öğretmen tarafından sınırlandırılmış olabilir."
    ]
  },
  "choice": {
    "title": "Test soruları: 1 gönderim hakkı",
    "body": [
      "Her test maddesi için bir seçenek işaretle ve son onaydan önce kontrol et. Yalnızca işaretlemek yanıtı göndermez; bu aşamada seçimini değiştirebilirsin.",
      "Yanıtı kesin olarak gönder düğmesine bastığında o madde kilitlenir. Doğru veya yanlış olması fark etmez: ikinci hak yoktur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır."
    ]
  },
  "deadline": {
    "title": "Son tarih ve geç gönderim",
    "body": [
        "Aktif çalışmanın üstünde son gönderim tarihini ve kalan gün, saat, dakika, saniyeyi görürsün. Tarihler Türkiye saatine göredir. Son tarih belirtilmemişse sayaç gösterilmez; öğretmenin ödevi ayrıca kapatabilir.",
        "Süre dolunca yeni yanıt gönderilemez; geç gönderim kabul edilmez. Otomatik ek süre verilmez. Gönderimin son tarihten önce kaydedilmiş olması gerekir; son saniyeyi bekleme. Daha önce kaydedilen yanıtların ve puanların korunur.",
        "Ek süre gerekiyorsa öğretmeninle iletişime geç. Öğretmenin süreyi uzatıp ödevi yeniden açarsa kalan haklarınla devam edebilirsin; kullanılan haklar kendiliğinden yenilenmez."
    ]
  },
  "results": {
    "title": "Sonuçlarını takip et",
    "body": [
      "Her gönderimin sonucunu sorunun altında, toplam ön puanını ilerleme alanında görürsün. “Tamamlanan”, en az bir kez yanıt gönderdiğin maddeleri sayar; kod sorusunda kalan ikinci hakkın olabilir.",
      "Kod sorularının en yüksek puanları ve test puanları toplanır. Son not öğretmen onayına bağlıdır. Onaylandığında son notun ve varsa öğretmeninin açıklaması ekranda görünür.",
      "Sorularda derste doğrudan gösterilmemiş işlemler bulunabilir; ders notları ve resmî dokümantasyon gibi kaynaklardan araştırma yapman beklenir. Şifreni unutursan sıfırlama için öğretmenine başvur."
    ]
  }
};

const LEGACY_PREVIOUS_PARAGRAPHS = new Map([
  ["Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Doğru yanıt, hakkın bitince gösterilir.", "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra yalnız puanın ve kalan hakkın gösterilir; doğru seçenek ve çözüm gösterilmez."],
  ["Her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Doğru yanıt, hakkın bitince gösterilir.", "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra yalnız puanın ve kalan hakkın gösterilir; doğru seçenek ve çözüm gösterilmez."],
  ["Hazır olduğunda Değerlendirmeye gönder düğmesine bas. Her kod sorusunda {kod_hakki} gönderim hakkın vardır; gönderimlerin en yüksek puanı geçerlidir. Gönderilen kodun hata vermesi de bir hak kullanır. Kalan hakkı düğmelerin yanında görürsün.", "Hazır olduğunda Değerlendirmeye gönder düğmesine bas. Genel olarak her kod sorusunda {kod_hakki} gönderim hakkın vardır; gönderimlerin en yüksek puanı geçerlidir. Gönderilen kodun hata vermesi de bir hak kullanır. Kalan hakkı düğmelerin yanında görürsün."],
  ["Her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra yalnız puanın ve kalan hakkın gösterilir; doğru seçenek ve çözüm gösterilmez.", "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra yalnız puanın ve kalan hakkın gösterilir; doğru seçenek ve çözüm gösterilmez."],
  [
    "Her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Doğru yanıt, hakkın bitince gösterilir.",
    "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra yalnız puanın ve kalan hakkın gösterilir; doğru seçenek ve çözüm gösterilmez."
  ],
  [
    "Aktif çalışmanın üstünde son gönderim tarihini ve kalan gün, saat, dakika, saniyeyi görürsün. Tarihler Türkiye saatine göredir. Son tarih belirtilmemişse sayaç gösterilmez; öğretmenin ödevi ayrıca kapatabilir.",
    "Aktif çalışmanın üstünde son gönderim tarihini ve kalan gün, saat, dakika, saniyeyi görürsün. Tarihler Türkiye saatine göredir. Sana kişisel bir son tarih tanımlandıysa ekranda o tarih gösterilir. Son tarih belirtilmemişse sayaç gösterilmez; öğretmenin ödevi ayrıca kapatabilir."
  ]
]);

const PREVIOUS_RELEASE_PARAGRAPHS = new Map([
  [
    "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra yalnız puanın ve kalan hakkın gösterilir; doğru seçenek ve çözüm gösterilmez.",
    "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra kaydın ve kalan hakkın gösterilir. Ödevdeki tüm soruları en az bir kez gönderdiğinde yalnız toplam ödev puanın görünür. Soru bazında puan veya doğru / yanlış bilgisi gösterilmez; öğretmen çözümleri yayımlayana kadar doğru seçenek ve çözüm gösterilmez."
  ],
  [
    "Gönderimden sonra kaydedildi mesajını ve puanı kontrol et. Bağlantı veya kayıt hatası varsa işlemi tamamlanmış sayma. Ekrandaki yeniden deneme düğmesini kullan; kaydedilmemiş çalışman varsa sayfayı yenilemeden önce Sonuçları indir ile bir kopyasını sakla. İndirdiğin dosya gönderim yerine geçmez.",
    "Gönderimden sonra kaydedildi mesajını ve tamamlanan soru sayısını kontrol et. Toplam puan, ödevdeki tüm soruları en az bir kez gönderdiğinde görünür. Bağlantı veya kayıt hatası varsa işlemi tamamlanmış sayma. Ekrandaki yeniden deneme düğmesini kullan; kaydedilmemiş çalışman varsa sayfayı yenilemeden önce Sonuçları indir ile bir kopyasını sakla. İndirdiğin dosya gönderim yerine geçmez."
  ],
  [
    "Her gönderimin sonucunu sorunun altında, toplam ön puanını ilerleme alanında görürsün. “Tamamlanan”, en az bir kez yanıt gönderdiğin maddeleri sayar; kod sorusunda kalan hakkın olabilir.",
    "Ödevdeki tüm soruları en az bir kez gönderdiğinde toplam ön puanını ilerleme alanında görürsün. Her sorunun puanı, doğru / yanlış bilgisi ve değerlendirme kontrolleri gösterilmez. “Tamamlanan”, en az bir kez yanıt gönderdiğin maddeleri sayar; kod sorusunda kalan hakkın olabilir."
  ],
  [
    "Kod sorularının en yüksek puanları ve test puanları toplanır. Son not öğretmen onayına bağlıdır. Onaylandığında son notun ve varsa öğretmeninin açıklaması ekranda görünür.",
    "Kod sorularının en yüksek puanları ve test puanları toplanır. Son not öğretmen onayına bağlıdır. Kişisel ek süreler dahil tüm öğrencilerin gönderim süreleri sona erdikten sonra öğretmenin çözümleri ayrıca yayımlayabilir. Sürenin dolması tek başına çözümleri açmaz. Yayımlandığında doğru yanıtları ve açıklamaları “Yayımlanan çözümler” bölümünde görürsün; varsa öğretmeninin not açıklaması da açılır. Ödev yeniden açılırsa veya yayımlama geri alınırsa çözümler tekrar gizlenir."
  ],
  [
    "Sana atanmış aktif çalışma otomatik açılır. Birden fazla aktif çalışma varsa başlıklarından geçiş yapabilirsin. Soruyu, istenen değişken adlarını ve puanını oku; soru menüsü veya Önceki / Sonraki soru düğmeleriyle ilerle.\n\nAktif çalışma yoksa “Şu anda aktif ödeviniz yok” mesajını görürsün. Soruların görünmesi için öğretmeninin ödevi açması gerekir.",
    "Sana atanmış aktif çalışma otomatik açılır. Birden fazla aktif çalışma varsa başlıklarından geçiş yapabilirsin. Soruyu, istenen değişken adlarını ve puanını oku; soru menüsü veya Önceki / Sonraki soru düğmeleriyle ilerle.\n\nAktif çalışma yoksa “Şu anda aktif ödeviniz yok” mesajını görürsün. Soruların görünmesi için öğretmeninin ödevi açması gerekir.\n\nÖğretmenin çözümleri yayımladığında “Yayımlanan çözümler” bölümünü aktif ödev olmasa da açabilirsin. Bu bölüm yalnız sana atanmış ödev formunun çözümlerini içerir."
  ]
]);

for (const [before,after] of [["Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra kaydın ve kalan hakkın gösterilir. Ödevdeki tüm soruları en az bir kez gönderdiğinde yalnız toplam ödev puanın görünür. Soru bazında puan veya doğru / yanlış bilgisi gösterilmez; öğretmen çözümleri yayımlayana kadar doğru seçenek ve çözüm gösterilmez.", "Genel olarak her test maddesinde {test_hakki} gönderim hakkın vardır. Yanıtı kesin olarak gönder düğmesine bastığında bir hak kullanılır. Hakkın kaldığı sürece yeniden gönderebilirsin; en yüksek puanın geçerli olur. Her madde ayrı gönderilir; bir maddeyi göndermek diğerlerinin hakkını azaltmaz. Doğru yanıt maddede belirtilen puanı, yanlış yanıt 0 puan alır. Gönderimden sonra kaydın ve kalan hakkın gösterilir. Toplam ödev puanın yalnız öğretmenin notları yayımladığında görünür; tüm soruları göndermek notları otomatik açmaz. Soru bazında puan veya doğru / yanlış bilgisi gösterilmez; öğretmen çözümleri yayımlayana kadar doğru seçenek ve çözüm gösterilmez."], ["Gönderimden sonra kaydedildi mesajını ve tamamlanan soru sayısını kontrol et. Toplam puan, ödevdeki tüm soruları en az bir kez gönderdiğinde görünür. Bağlantı veya kayıt hatası varsa işlemi tamamlanmış sayma. Ekrandaki yeniden deneme düğmesini kullan; kaydedilmemiş çalışman varsa sayfayı yenilemeden önce Sonuçları indir ile bir kopyasını sakla. İndirdiğin dosya gönderim yerine geçmez.", "Gönderimden sonra kaydedildi mesajını ve tamamlanan soru sayısını kontrol et. Notlar öğretmenin yayımladığında görünür. Bağlantı veya kayıt hatası varsa işlemi tamamlanmış sayma. Ekrandaki yeniden deneme düğmesini kullan; kaydedilmemiş çalışman varsa sayfayı yenilemeden önce Sonuçları indir ile bir kopyasını sakla. İndirdiğin dosya gönderim yerine geçmez."], ["Ödevdeki tüm soruları en az bir kez gönderdiğinde toplam ön puanını ilerleme alanında görürsün. Her sorunun puanı, doğru / yanlış bilgisi ve değerlendirme kontrolleri gösterilmez. “Tamamlanan”, en az bir kez yanıt gönderdiğin maddeleri sayar; kod sorusunda kalan hakkın olabilir.", "Gönderimlerden sonra kaydedildi mesajını, tamamlanan soru sayısını ve kalan haklarını görürsün. “Tamamlanan”, en az bir kez yanıt gönderdiğin maddeleri sayar. Tüm soruları göndermek veya sürenin dolması notları otomatik açmaz. Her sorunun puanı, doğru / yanlış bilgisi ve değerlendirme kontrolleri gösterilmez."], ["Kod sorularının en yüksek puanları ve test puanları toplanır. Son not öğretmen onayına bağlıdır. Kişisel ek süreler dahil tüm öğrencilerin gönderim süreleri sona erdikten sonra öğretmenin çözümleri ayrıca yayımlayabilir. Sürenin dolması tek başına çözümleri açmaz. Yayımlandığında doğru yanıtları ve açıklamaları “Yayımlanan çözümler” bölümünde görürsün; varsa öğretmeninin not açıklaması da açılır. Ödev yeniden açılırsa veya yayımlama geri alınırsa çözümler tekrar gizlenir.", "Kişisel ek süreler dahil tüm öğrencilerin gönderim süreleri sona erdikten sonra öğretmenin notları ve çözümleri ayrı ayrı yayımlayabilir. Notlar yayımlandığında bu sayfada “Bildirimler” ve “Yayımlanan notlar” bölümlerini görürsün; yalnız kendi toplam ödev puanın ve varsa onaylı son notun açılır. Çözümler ayrıca yayımlandığında doğru yanıtları ve açıklamaları “Yayımlanan çözümler” bölümünde görürsün. Bu bölümler aktif ödev olmasa da erişilebilirdir. Ödev yeniden açılırsa veya yayımlama geri alınırsa ilgili içerik ve bildirimi tekrar gizlenir."], ["Sorularda derste doğrudan gösterilmemiş işlemler bulunabilir; ders notları ve resmî dokümantasyon gibi kaynaklardan araştırma yapman beklenir. Şifreni unutursan sıfırlama için öğretmenine başvur.", "Kod sorularının en yüksek puanları ve test puanları toplanır. Son not öğretmen onayına bağlıdır. Öğretmeninin not açıklaması, notlar ve çözümler yayımlanmışsa görünür. Sorularda derste doğrudan gösterilmemiş işlemler bulunabilir; ders notları ve resmî dokümantasyon gibi kaynaklardan araştırma yapman beklenir. Şifreni unutursan sıfırlama için öğretmenine başvur."]]) PREVIOUS_RELEASE_PARAGRAPHS.set(before,after);

PREVIOUS_RELEASE_PARAGRAPHS.set("Kişisel ek süreler dahil tüm öğrencilerin gönderim süreleri sona erdikten sonra öğretmenin notları ve çözümleri ayrı ayrı yayımlayabilir. Notlar yayımlandığında bu sayfada “Bildirimler” ve “Yayımlanan notlar” bölümlerini görürsün; yalnız kendi toplam ödev puanın ve varsa onaylı son notun açılır. Çözümler ayrıca yayımlandığında doğru yanıtları ve açıklamaları “Yayımlanan çözümler” bölümünde görürsün. Bu bölümler aktif ödev olmasa da erişilebilirdir. Ödev yeniden açılırsa veya yayımlama geri alınırsa ilgili içerik ve bildirimi tekrar gizlenir.","Kişisel ek süreler dahil tüm öğrencilerin gönderim süreleri sona erdikten sonra öğretmenin notları ve çözümleri ayrı ayrı yayımlayabilir. Notlar yayımlandığında bu sayfada “Bildirimler” ve “Yayımlanan notlar” bölümlerini görürsün; yalnız kendi toplam ödev notun açılır; öğretmenin son notu onayladıysa bu not gösterilir. Çözümler ayrıca yayımlandığında doğru yanıtları ve açıklamaları “Yayımlanan çözümler” bölümünde görürsün. Bu bölümler aktif ödev olmasa da erişilebilirdir. Ödev yeniden açılırsa veya yayımlama geri alınırsa ilgili içerik ve bildirimi tekrar gizlenir.");

const DEFAULT_ATTEMPTS = {code:2,choice:1};
function guidePolicy(value) {
  const code=Number(value?.code), choice=Number(value?.choice);
  return {
    code:Number.isInteger(code)&&code>=1&&code<=100?code:DEFAULT_ATTEMPTS.code,
    choice:Number.isInteger(choice)&&choice>=1&&choice<=100?choice:DEFAULT_ATTEMPTS.choice
  };
}
function substitute(value,policy) {
  return String(value ?? '').replaceAll('{kod_hakki}',String(policy.code)).replaceAll('{test_hakki}',String(policy.choice));
}
function migrateOldDefaults(guide) {
  const defaults=new Map(DEFAULT_STUDENT_GUIDE.sections.map(section=>[section.id,section]));
  for(const section of guide.sections || []) {
    const old=LEGACY_DEFAULT_SECTIONS[section.id], current=defaults.get(section.id);
    if(!old||!current)continue;
    if(section.title===old.title)section.title=current.title;
    const previous=old.body, replacement=current.body.split('\n\n');
    section.body=section.body.split('\n\n').map(paragraph=>{
      const i=previous.indexOf(paragraph);
      const migrated = i>=0 ? replacement[i] : LEGACY_PREVIOUS_PARAGRAPHS.get(paragraph) || paragraph;
      let result = migrated;
      for (let pass=0; pass<5 && PREVIOUS_RELEASE_PARAGRAPHS.has(result); pass++) result = PREVIOUS_RELEASE_PARAGRAPHS.get(result);
      return result;
    }).join('\n\n');
  }
  return guide;
}
export function guideContent(value) { return migrateOldDefaults(structuredClone(value || DEFAULT_STUDENT_GUIDE)); }

// Teacher-authored content is plain text. Never interpret HTML from a guide.
export function renderStudentGuide(root, value, attemptPolicy=null, questionLimits=null) {
  const guide = guideContent(value), policy=guidePolicy(attemptPolicy);
  const exceptions=Object.entries(questionLimits||{})
    .filter(([id,limit])=>/^Q[1-6](?:\.[1-3])?$/.test(id)&&Number.isInteger(Number(limit))&&Number(limit)>=1&&Number(limit)<=1000)
    .sort(([a],[b])=>a.localeCompare(b,'tr',{numeric:true}));
  const key = JSON.stringify([guide,policy,!!attemptPolicy,exceptions]);
  if (root.dataset.guide === key) return;
  const wasOpen = root.open;
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const summary = make('summary');
  const icon = make('span','guide-icon','?'); icon.setAttribute('aria-hidden','true');
  const label = make('span','guide-summary');
  label.append(make('strong','',substitute(guide.title,policy)),make('span','',substitute(guide.subtitle,policy)));
  const toggle = make('span','guide-toggle'); toggle.setAttribute('aria-hidden','true');
  summary.append(icon,label,toggle);
  const body = make('div','guide-body'), rules = make('div','guide-rules');
  rules.setAttribute('aria-label','Kısa kurallar');
  guide.highlights.forEach((highlight,index) => {
    const item = make('span');
    let heading=substitute(highlight.title,policy);
    if(index<2){
      const count=index===0?policy.code:policy.choice;
      if(!/\{(?:kod|test)_hakki\}/.test(highlight.title)) {
        heading=/\d+\s*hak(?:kı)?/i.test(heading)
          ? heading.replace(/\d+(?=\s*hak(?:kı)?)/i,String(count))
          : `${count} hak · ${heading}`;
      }
    }
    item.append(make('strong','',heading),make('span','',substitute(highlight.text,policy))); rules.append(item);
  });
  const sections = make('div','guide-sections');
  guide.sections.forEach((section,index) => {
    const block = make('section',section.tone === 'deadline' ? 'guide-deadline' : '');
    const heading = make('h2','',`${index+1}. ${substitute(section.title,policy)}`);
    heading.id = `${root.id}-${section.id}`;
    block.setAttribute('aria-labelledby',heading.id); block.append(heading);
    for (const paragraph of section.body.split(/\n\s*\n/)) block.append(make('p','',substitute(paragraph,policy)));
    sections.append(block);
  });
  if(exceptions.length){
    const block=make('section');
    const heading=make('h2','','Bu sorulara özel haklar');heading.id=`${root.id}-question-limits`;
    block.setAttribute('aria-labelledby',heading.id);block.append(heading);
    block.append(make('p','','Aşağıdaki sorular için gösterilen hak sayıları geçerlidir. Diğer kod ve test sorularında üstteki genel sayılar kullanılır.'));
    for(const [id,limit] of exceptions)block.append(make('p','',`${id}: ${limit} gönderim hakkı`));
    sections.append(block);
  }
  body.append(make('p','',attemptPolicy ? 'Aşağıdaki hak sayıları açık olan çalışman için geçerlidir.' : 'Aşağıda varsayılan haklar gösterilir. Aktif bir çalışma açıldığında kılavuz o çalışmanın hak sayılarına göre güncellenir.'),rules,sections); root.replaceChildren(summary,body);
  root.dataset.guide = key; root.open = wasOpen; root.hidden = false;
}
