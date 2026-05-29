# 借助AI开发NotionNext
> 迁移自：[借助AI开发NotionNext](https://docs.tangly1024.com/article/notion-next-develop-with-ai)
> 发布日期：2025-4-25
> 最后编辑：2026-5-2
> 原栏目：⌨ 开发教程

## 前言

如果不会任何编程语言能否定制一个新主题？

结论是可以的，但是会有些难，相当于完全没有某个行业的客户积累与产品积累，却要一下子开一家这个行业的公司。但是如果你擅长通过AI进行自主学习与挖掘的话，会有一定的帮助。


## 云环境

建议先阅读‣ 这篇文章，其中介绍了开发NotionNext项目可能需要具备的一些基础知识。


### GitHub Codespaces

GitHub 本身自带 Codespaces 云环境，简单来说，在您的 GitHub 仓库中，点击 Code、再点击 **Create codespace** 打开云端开发环境；也可在加号处新建一个云开发空间：

![28f32ba842c3ed98116d7a6e2ad5c29.png](/legacy/e77927a16e23b9c3.png)

在 Codespace 云空间中，界面与本地使用的 **VS Code** 相近。点击上方右侧的 Copilot 图标即可与 AI 聊天。

![image.png](/legacy/fec8dc5f53d7f1fb.png)

Copilot会实时关注您当前打开的文件。通过对话，可以实现对文件的修改或建议。


### Google Firebase Studio

Google推出了FirebaseStudio，支持将您的github项目导入这个云环境进行开发，其原理和Github的Codespace差不多。

不过FirebaseStudio似乎不能汉化界面，会有一定使用难度。另一方面gemini的ai用量不像copilot专为编程设计、后者有大量的github、vscode用户群体，因此能力有限，问几句话就歇菜了。

![image.png](/legacy/43a9e2122e987f4d.png)

因此我还是建议使用Codespace作为云开发环境，不但与github的集成更好，同时Copilot的AI性能更强大。


## 使用Firebase进行AI开发演示

点击下方链接，访问并注册Firebase。

[https://studio.firebase.google.com/](https://studio.firebase.google.com/)

![image.png](/legacy/f16a67253dde79a2.png)

来到项目首页，选择ImportRepo

![image.png](/legacy/11f391869e296bfb.png)

输入Github空间即可

![image.png](/legacy/6a7806b53f1080b8.png)

Firebase会自动导入项目代码并进行环境安装。

![image.png](/legacy/8e06ab05311d9b7f.png)

安装完成后代码显示如下

![image.png](/legacy/9dfe4df0328b03da.png)


## 主题定制

这里用firebase示范，codespace的使用方法基本一致。


### 复制一个主题文件夹

不建议直接修改原先的主题，否则后续如果我也同步修改了这个主题文件夹，在更新的过程可能会产生大量的冲突。

在themes 目录，找到你较喜欢的主题，或者和你预期的新主题结构比较类似的主题，例如example主题文件夹。各主题的补充说明见仓库 [docs/themes](https://github.com/tangly1024/NotionNext/tree/main/docs/themes)（如 Fuwari、Claude 等）。点击右键copy复制这个文件夹。

![image.png](/legacy/0a4be92d0f2060f3.png)

然后右键点击themes文件夹，选择paste粘贴至此。

![image.png](/legacy/43bc73fb5994a33f.png)

粘贴后会出现一个新的文件夹，我刚复制的文件夹是example 因此这里粘贴后的文件夹名字为example copy

![image.png](/legacy/bdd104d76776fa20.png)


### 重命名主题

我希望新主题名为dream，因此将example copy文件夹重命名，右键点击文件夹，选择rename，并且输入新的文件夹名称，按下回车确认即可。

![image.png](/legacy/f5ca83ba0b823745.png)

![image.png](/legacy/a94cfb41e1c57264.png)


## 修改主题内容

双击打开dream / index.js 文件，并且用附件形式引入这个文件：点击gemini聊天窗口下的附件按钮。选择file

![image.png](/legacy/8c7980c5224652cb.png)

在弹出的文件选择框中，选择当前的index.js文件。

![image.png](/legacy/9235c98b5cd3fafd.png)

> 如果是用Copilots的话可以省去此步骤

然后给gemini发一句话：

> 这个主题的顶部导航栏在哪，是哪个文件，并且在这个导航栏中做一个修改，在导航栏的左侧加一行蓝色文字，内容是“新主题dream”创建成功。
> 文件应该在/themes/dream/components目录下

紧接着ai会告诉你所有的内容，然后会给出一份代码修改建议：

![image.png](/legacy/5aa43dd8558d246f.png)

点击建议框右侧的Review changes可以审视修改的内容，点击左侧的Updates file，即可自动修改文件。


## 运行启动项目

启动项目之前可以先将当前主题切换为您刚创建的dream主题。最简单的方法可以是修改blog.config.js文件

![image.png](/legacy/50346835df66470c.png)

在控制台输入 npm run dev 即可运行项目

![image.png](/legacy/383ef20d0fce8b02.png)

运行启动后，**按住键盘Ctrl键再鼠标点击控制台打印处的http://locahost:3000** 即可打开实时调试页面：

![image.png](/legacy/f379c4ee6e108960.png)

firebase会自动分配一个临时网址用于访问调试页面。

![image.png](/legacy/93328a79c3c5e94f.png)

打开后即可看到刚刚的修改已经生效了，接下来您的所有代码修改都会实时反映在这个页面上。

我们可以切换到刚刚的编辑页面手动修改内容：

![image.png](/legacy/ca42502c177f35e3.png)

然后再看页面就已经生效了

![image.png](/legacy/024243b88fc53f56.png)

接下来就是不停的和AI对话，告诉他需要改什么，给出结果，然后你点击更新文件即可。

## 用 AI 辅助搬运或二次创作主题

如果你的目标不是改一行文字，而是把一个喜欢的网站风格搬到 NotionNext，建议不要直接让 AI “照着这个网站写一个主题”。更稳妥的做法是先拆解，再分步骤改造。

### 1. 先拆解参考站点

把你喜欢的网站链接、截图或设计稿发给 AI，让它先输出结构分析，而不是直接写代码。

可以这样问：

> 请帮我拆解这个网站的 UI，不要写代码。请按页面结构、布局网格、颜色、字体层级、卡片样式、导航、移动端表现、深色模式可能方案输出。最后总结哪些部分适合迁移到 NotionNext 主题。

拿到分析后，再人工判断哪些是你真正需要的。一个主题通常先做首页、列表页、文章页、移动端导航和深色模式，不建议一开始就追求所有细节。

### 2. 选择合适的基准主题

不同主题适合不同方向：

- `example`：最适合学习主题结构，适合从零开始。
- `simple`：适合简洁博客、轻量卡片列表。
- `endspace`：适合内容阅读、长期稳定维护。
- `starter`：适合官网、产品介绍、功能区块丰富的站点。
- `gitbook`：适合文档站、知识库。
- `landing`：适合落地页和单页介绍。

给 AI 的提示词可以这样写：

> 我想在 NotionNext 中做一个新主题，参考风格是「……」。请根据 `themes/` 目录中现有主题的定位，建议我应该基于 `example`、`simple`、`endspace`、`starter`、`gitbook` 或 `landing` 哪一个开始，并说明原因。请先不要修改代码。

### 3. 让 AI 先给改造清单

不要一次性要求 AI 改完整主题。先让它列出需要改的文件和顺序。

推荐提示词：

> 我已经复制了 `themes/example` 为 `themes/dream`。请阅读 `themes/dream/index.js`、`themes/dream/config.js` 和 `themes/dream/components`，按优先级列出要改造的文件。目标是实现「……」风格。请把任务拆成：首页布局、文章卡片、导航、文章页、移动端、深色模式、配置项、文档。

如果 AI 给出的文件很多，先让它只处理一个区域，例如首页文章卡片。每次修改后都运行项目看效果，再继续下一步。

### 4. 把视觉要求写成可执行规格

AI 更擅长执行明确约束。与其说“做得更像 Google 风格”，不如写成：

- 页面最大宽度：`1200px`
- 卡片圆角：`12px`
- 卡片阴影：浅色模式轻阴影，深色模式用边框
- 首页布局：桌面端三列，移动端一列
- 字体层级：标题、摘要、元信息分别控制
- 主色：用 CSS 变量或主题 `config.js` 控制

可以让 AI 先把这些整理成一份主题规格：

> 请把下面的风格描述整理成 NotionNext 主题开发规格，要求能指导 React/Tailwind 开发。请输出页面、组件、配置项、响应式、深色模式和验收标准。

### 5. 逐页验证

主题开发至少要检查这些页面：

- 首页
- 文章详情页
- 文章列表分页
- 归档页
- 分类页
- 标签页
- 搜索页
- 404 页
- 移动端菜单
- 深色模式

如果要贡献到主仓库，还需要补齐：

- `docs/user-guide/themes/<主题名>.md`
- `public/images/themes-preview/<主题名>.png`
- `public/images/themes-preview/<主题名>.webp`
- `conf/themeSwitch.manifest.js`

更完整的主题贡献要求见 [主题迁移指南](https://github.com/notionnext-org/NotionNext/blob/main/docs/developer/THEME_MIGRATION_GUIDE.zh-CN.md)。

### 6. 适合发到社区征集的方向

如果你还没有开始写代码，只是有想法，可以先在 GitHub Discussions 发起主题风格建议。适合征集的方向包括：

- 日式便当 / 卡片式圆角矩形布局
- Google Material / 扁平化内容布局
- 经典博客主题致敬，例如 Hexo、WordPress、Typecho 风格
- 极简作品集 / 个人品牌站
- SaaS / Product Hunt / 开源项目官网
- Magazine / Starter / GitBook 这类功能型主题

这样其他人可以一起补充参考站点、截图和使用场景，成熟后再拆成可认领的 Issue 或 PR。


## 保存代码

所有的代码需要提交到git仓库才能被保存，这里涉及到git的使用操作，git本身是为大型多人团队协作设计、其功能强大，需要一定的学习。我这里做一个最简单的提交代码的演示。

点击左侧的Source Control图标

![image.png](/legacy/44b501d4aa35e3d1.png)

这里列出了所有本次的更改内容，你需要将确定要保存的修改内容进行确认。

![image.png](/legacy/b64da90d4c02c220.png)

鼠标指向每个文件的右侧都会浮现一个加号，点击表示此文件需要保存到git仓库中。

![image.png](/legacy/724f484efb913b6f.png)

点击后的文件会显示再Staged Changes这个分栏下：

![image.png](/legacy/b491f007b69cc6ef.png)

可以点击Changes右侧的加号，一次性确认所有文件。

![image.png](/legacy/0e6dae3842759bbb.png)

要提交保存的文件确认后，在上方的Message栏中填写这次提交改动的功能说明，这是必填项，便于日后回查此次提交的内容。例如我在这里输入: “创建了新的主题dream”

![image.png](/legacy/2575a497cc9d54f4.png)

填写完说明内容后，点击下方的commit按钮提交，提交后下方列表就变空了，因为已经没有待确认和待提交的内容，所以这里就没有可以显示的内容。

![image.png](/legacy/938b55e65a5fc0a6.png)

我们注意到这里有一个按钮，如果你是创建了一个新的git分支会显示上面的Publish branch按钮，如果是在原有的分支例如main分支上进行开发，那么这里会显示 sync changes ，表示与你的github云端仓库需要进行同步。

![image.png](/legacy/96e6c3f8503d234b.png)

这里我们点击它，将内容同步到github云端。


### 授权Github

> 如果用的是github提供的codespace环境则无需下列步骤。

如果这里你是首次同步的话，会提示你要获得github插件的许可，点击同意即可；

![image.png](/legacy/cf9842e09b63c675.png)

然后会得到一个授权码，点击copy $ continue to github

![image.png](/legacy/6dd185929839837e.png)

在自动跳转到的页面中粘贴或输入验证码。

![image.png](/legacy/be4a73fab045f31a.png)

然后再在二次确认页面点击 Authorize Visual Studio Code即可。

![image.png](/legacy/13011e1050828590.png)

![image.png](/legacy/11c82c33f16150cd.png)

如果上述步骤走不通的话，firebase也支持用github的token进行提交验证，这是另一种可选的授权方案，不过基本用不到，此处不做展开。

![image.png](/legacy/0f442d3f4d9d85bd.png)


## 代码提交同步完成

此时再看你的SourceControl 页面，已经没有待提交、待审核、和带同步的任务了。

![image.png](/legacy/c7a6b6ddf555c1ec.png)

而在github项目中能看到刚刚的提交记录说明，和对应的文件内容

![image.png](/legacy/243ceed8545d7a57.png)

接下来vercel将会自动识别代码的修改并自动部署您的站点。

以上就是一个完整的，借助云环境+AI开发一个小功能，并同步到Github的流程。


## 结尾

需要注意的是，AI和云环境只是一个效率工具，本质是帮不懂的人快速入门学习，帮住本来就懂的人节省开发时间。因此要想彻底掌握开发，还需要结合学习NotionNext所使用的框架技术和文件目录的规范结构。

将来再过几年，等AI-Agent智能体普及之后，就完全不需要上面这么复杂的步骤了，到时候只要负责发布命令，如何实现都是智能体应该考虑的。

## 原文链接

https://docs.tangly1024.com/article/notion-next-develop-with-ai
