const categoryTones: Record<string, string> = {
  'Sosyal': 'social',
  'Kültür ve sanat': 'culture',
  'Müzik': 'music',
  'Yemek ve içecek': 'food',
  'Spor ve sağlık': 'wellness',
  'Teknoloji': 'technology',
  'Eğitim': 'education',
  'Doğa ve gezi': 'nature',
};

export function categoryToneClass(categoryName: string) {
  return `event-category-dot event-category-dot--${categoryTones[categoryName] ?? 'default'}`;
}
