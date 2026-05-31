// 信源①：中国高等教育学会《全国普通高校大学生竞赛分析报告》榜单（约 84 项）。
// 这是最权威、最稳定的"骨架"清单——名单一年只在 3 月更新一次，所以人工维护这份
// 种子列表完全可行，且最可靠。爬来的动态信息（报名时间等）再覆盖到这上面。
//
// cat 五分类：综合 / 经管 / 理工 / 人文 / 媒传
// level: "A" = A类/榜单核心赛事；"List" = 榜单内其它赛事
// 报名时间(deadline)请每年核对官网后填写；这里给的是示例，标 null 表示待抓取补充。

export async function fetchCaheList() {
  return [
    { name: "中国国际“互联网+”大学生创新创业大赛", cat: "综合", level: "A", org: "教育部", majors: "全专业 · 创业/项目", deadline: null, url: "https://cy.ncss.cn/", schoolRound: true },
    { name: "“挑战杯”全国大学生课外学术科技作品竞赛", cat: "综合", level: "A", org: "共青团中央 等", majors: "全专业 · 学术科技", deadline: null, url: "http://www.tiaozhanbei.net/", schoolRound: true },
    { name: "“挑战杯”中国大学生创业计划竞赛", cat: "综合", level: "A", org: "共青团中央 等", majors: "全专业 · 创业", deadline: null, url: "http://www.tiaozhanbei.net/", schoolRound: true },
    { name: "全国大学生数学建模竞赛", cat: "理工", level: "A", org: "中国工业与应用数学学会", majors: "数学/统计/计算机/工科", deadline: null, url: "https://www.mcm.edu.cn/", schoolRound: false },
    { name: "全国大学生电子设计竞赛", cat: "理工", level: "A", org: "教育部 · 工信部", majors: "电子/电气/自动化/通信", deadline: null, url: "http://nuedc.xjtu.edu.cn/", schoolRound: false },
    { name: "全国大学生机械创新设计大赛", cat: "理工", level: "A", org: "教育部机械基础教指委", majors: "机械/车辆/材料", deadline: null, url: "", schoolRound: true },
    { name: "全国大学生结构设计竞赛", cat: "理工", level: "A", org: "中国高等教育学会", majors: "土木/工程力学", deadline: null, url: "", schoolRound: true },
    { name: "蓝桥杯全国软件和信息技术专业人才大赛", cat: "理工", level: "List", org: "工信部人才交流中心", majors: "计算机/软件/电子", deadline: null, url: "https://dasai.lanqiao.cn/", schoolRound: false },
    { name: "“中国软件杯”大学生软件设计大赛", cat: "理工", level: "List", org: "工信部 · 教育部 等", majors: "软件/计算机", deadline: null, url: "https://www.cnsoftbei.com/", schoolRound: false },
    { name: "全国大学生集成电路创新创业大赛", cat: "理工", level: "List", org: "工信部人才交流中心", majors: "微电子/电子", deadline: null, url: "", schoolRound: false },
    { name: "全国大学生市场调查与分析大赛（正大杯）", cat: "经管", level: "List", org: "教育部 · 中国商业统计学会", majors: "市场营销/经济/统计", deadline: null, url: "", schoolRound: true },
    { name: "全国大学生会计/审计技能大赛", cat: "经管", level: "List", org: "行业协会", majors: "会计/财管/审计", deadline: null, url: "", schoolRound: true },
    { name: "全国大学生文化旅游与会展竞赛", cat: "经管", level: "List", org: "中国商业经济学会 等", majors: "会展/旅游管理/工商", deadline: null, url: "", schoolRound: false },
    { name: "“外研社·国才杯”全国大学生外语能力大赛", cat: "人文", level: "List", org: "外研社", majors: "外语/全专业", deadline: null, url: "https://www.unipus.cn/ucontest", schoolRound: true },
    { name: "全国大学生英语竞赛（NECCS）", cat: "人文", level: "List", org: "高校大学外语教学研究会", majors: "全专业 · 英语", deadline: null, url: "", schoolRound: true },
    { name: "“田家炳杯”全国师范生教学技能竞赛", cat: "人文", level: "List", org: "相关教育学会", majors: "师范/教育/中文/历史", deadline: null, url: "", schoolRound: true },
    { name: "全国大学生广告艺术大赛", cat: "媒传", level: "List", org: "教育部高校广告学教指委", majors: "广告/视传/数媒/新闻", deadline: null, url: "http://www.sun-ada.net/", schoolRound: false },
    { name: "中国大学生计算机设计大赛", cat: "媒传", level: "List", org: "相关教指委", majors: "数媒/动画/软件/设计", deadline: null, url: "https://jsjds.blcu.edu.cn/", schoolRound: true },
  ];
}
