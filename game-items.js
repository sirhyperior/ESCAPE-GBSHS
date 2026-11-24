(function (root) {
  'use strict';

  // Each character is one pixel. A dot leaves the background transparent.
  const items = {
    nightVision: {
      name: '야간투시경',
      type: 'passive',
      description: '주변이 더 잘 보이게 된다. 왜 이게 기숙사에 있는지는 아무도 모른다...',
      feedback: { color: '#b9e691', held: '원형 시야' },
      palette: { o: '#192922', d: '#34684a', g: '#79bd67', l: '#dcf08b' },
      pixels: [
        '............', '............', '...oooooo...', '..oddddddo..',
        '.oooooooooo.', 'odggooogggdo', 'odlgdodlggdo', 'odggdodgggdo',
        '.oddo.odddo.', '..oo...ooo..', '............', '............',
      ],
    },
    monster: {
      name: '몬스터',
      type: 'active',
      consumable: true,
      description: '학생들이 물처럼 마시는 카페인 에너지 드링크. 마시면 힘이 솟는다고 한다.',
      feedback: { color: '#95e5ee', speed: '이동 속도 증가' },
      palette: { o: '#161d1a', d: '#343d37', s: '#a4a79c', l: '#b9e565' },
      pixels: [
        '....ssss....', '...sdddss...', '...sddddo...', '...sdlllo...',
        '...sllldo...', '...sldllo...', '...sldllo...', '...sldldo...',
        '...sddldo...', '...sddddo...', '...sddddo...', '....ssss....',
      ],
    },
    bbGun: {
      name: '비비탄총',
      type: 'active',
      consumable: true,
      description: '누군가 집에서 가져온 비비탄총. 총알은 하나밖에 없지만 맞으면 아플 것 같다.',
      feedback: { color: '#ffd288', stun: '발각 해제 · 사감 정지' },
      palette: { o: '#252427', d: '#65616b', s: '#b4acad', r: '#ff9b52' },
      pixels: [
        '............', '............', '.....o...o..', '..ossssssor.',
        '.oddddddddr.', '.ooooooddoo.', '..odsdooo...', '..odsoo.....',
        '.oddo.......', '.oddo.......', '.ooo........', '............',
      ],
    },
    sneakers: {
      name: '운동화',
      type: 'passive',
      description: '조금 비싸보이는 운동화다. 신으면 뛰기 편해질 것 같다.',
      feedback: { color: '#ffbb9e', held: '최대 스태미나 증가', sprint: '달리기 속도 증가' },
      palette: { o: '#30262a', d: '#aa4a4c', c: '#ef8475', w: '#f2e4c8' },
      pixels: [
        '............', '............', '..ooo.......', '.ocdwo......',
        '.ocdcwo.....', '.ocdccwo....', '.odddccdooo.', '.odddcccccco',
        '.owwwwwwwwwo', '..ooooooooo.', '............', '............',
      ],
    },
    aiGlasses: {
      name: 'AI 안경',
      type: 'passive',
      description: '요즘 논란이 되는 물건이라 학교에 있으면 안될 것 같다. 배터리가 거의 남아있지 않다.',
      feedback: { color: '#8bdce4', held: '최단 경로 표시', spent: 'AI 안경 방전' },
      palette: { o: '#17272d', d: '#467988', c: '#77d4e0', l: '#d3f6f1' },
      pixels: [
        '............', '............', '............', '..oo....oo..',
        '.oddo..oddo.', 'ooccdoooccdo', 'odlcdo.odldo', '.ocdo...odo.',
        '..oo.....oo.', '............', '............', '............',
      ],
    },
    reagent: {
      name: '이상한 시약',
      type: 'active',
      consumable: true,
      description: "누군가 화학실에서 들고 온 것 같다. 반쯤 지워진 라벨링의 앞부분에는 '스태미나...' 가 쓰여있다.",
      feedback: { color: '#e4acf7', freeSprint: '스태미나 소모 없음', exhausted: '즉시 지침' },
      palette: { o: '#291d34', d: '#704689', p: '#c680ce', l: '#e4d0d9', s: '#8d7859' },
      pixels: [
        '............', '....sso.....', '....sso.....', '....ldo.....',
        '....ldo.....', '...lldoo....', '..olppdoo...', '.olpdppdoo..',
        '.oldlppddo..', '.odddddddo..', '..oooooooo..', '............',
      ],
    },
    emp: {
      name: 'EMP',
      type: 'active',
      consumable: true,
      description: '주위에 있는 전자기기들이 꺼진다. 왜 이게 기숙사에 있는지는 아무도 모른다...',
      feedback: { color: '#8de5d8', blackout: '사감 손전등 차단' },
      palette: { o: '#22282a', d: '#59656a', s: '#9ea8a3', b: '#7fe0e3' },
      pixels: [
        '............', '........so..', '........do..', '..ooooo.do..',
        '.osssssosoo.', '.osdbbdddso.', '.osdbbdddso.', '.osddddddso.',
        '.osdssdsdso.', '..oooooooo..', '............', '............',
      ],
    },
    bread: {
      name: '먹다 만 빵',
      type: 'passive',
      description: '아침에 나왔지만 다 먹지 않은 듯 하다. 들고 다니면 부스러기가 떨어질 것 같다.',
      feedback: { color: '#f2c883', held: '부스러기로 이동 경로 표시' },
      palette: { o: '#563926', c: '#b97843', b: '#e8be77', l: '#f8dfaa' },
      pixels: [
        '............', '............', '..oooooo....', '.ocbbbo.....',
        'oclllbo.....', 'oclbllboo...', 'oclllbbo....', 'ocblllbo....',
        '.ocbbbbbco..', '..oooooooo..', '............', '............',
      ],
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = items;
  else root.DormItems = items;
})(globalThis);
