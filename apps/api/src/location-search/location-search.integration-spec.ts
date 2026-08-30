import { MapTilerLocationSearchImplementation } from './location-search.implementation';

describe('MapTilerLocationSearchImplementation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('includes the district from MapTiler context in a location suggestion', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ features: [{
      geometry: { coordinates: [28.9726, 41.0878] },
      text: 'Kağıthane Caddesi',
      place_name: 'Merkez Mahallesi, Kağıthane Caddesi, 34400 Kâğıthane/İstanbul, Türkiye',
      place_type: ['address'],
      context: [
        { id: 'place.1', text: 'Gürsel' },
        { id: 'municipal_district.1', text: 'Merkez Mahallesi' },
        { id: 'joint_municipality.1', text: 'Kâğıthane' },
        { id: 'county.1', text: 'İstanbul' },
      ],
    }] }))); 

    const locations = new MapTilerLocationSearchImplementation('test-key');

    await expect(locations.search({ actor: { userId: 'user-1', verification: 'VERIFIED' }, query: 'Kağıthane Caddesi', city: 'Istanbul' })).resolves.toMatchObject({
      items: [expect.objectContaining({ district: 'Kâğıthane' })],
    });
  });

  it('resolves a district when a map coordinate is selected', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ features: [{
      text: 'Sultanahmet',
      place_name: 'Sultanahmet, Fatih/İstanbul, Türkiye',
      context: [{ id: 'joint_municipality.2', text: 'Fatih' }, { id: 'county.2', text: 'İstanbul' }],
    }] })));

    const locations = new MapTilerLocationSearchImplementation('test-key');

    await expect(locations.reverse({ actor: { userId: 'user-1', verification: 'VERIFIED' }, latitude: 41.0054, longitude: 28.9768 })).resolves.toMatchObject({
      district: 'Fatih',
      address: 'Sultanahmet, Fatih/İstanbul, Türkiye',
    });
  });
});
