// Read-only display translations for the example briefs shipped with the first prototype.
// Stored project history and arbitrary user-authored content are preserved.
const legacyExamples: Record<string,string> = {
  "为 Northstar 制作一个英文企业官网。我们帮助成长中的团队连接业务数据、自动化工作流程。采用深色玻璃科技风格，包含服务介绍、关于我们、联系表单和清晰的 CTA。": "Build an English enterprise website for Northstar. We help growing teams connect business data and automate workflows. Use a dark glass visual style, with services, about, a contact form, and a clear CTA.",
  "为 Forma Advisory 制作英文品牌咨询公司官网。提供品牌策略、视觉设计与数字体验服务，采用温暖的编辑式排版、米白背景与橙色强调，重点展示服务和预约咨询表单。": "Create an English brand consultancy website for Forma Advisory. Services include brand strategy, visual identity, and digital experiences. Use warm editorial typography, an ivory background, orange accents, and a consultation form.",
  "为 Signal Studio 制作一个英文创意工作室官网。业务是品牌设计、网站设计与交互体验，使用黑色和荧光绿色，大胆排版，包含服务、关于我们和项目咨询表单。": "Build an English creative studio website for Signal Studio. We offer brand design, website design, and interactive experiences. Use black and electric lime, expressive typography, services, about, and a project inquiry form."
};
export function englishDisplayMessage(content:string):string {
  return legacyExamples[content] || content;
}
export function formatStudioDate(value:string):string {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Unknown date':new Intl.DateTimeFormat('en-GB',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
}
