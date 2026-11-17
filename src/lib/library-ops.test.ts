import { beforeEach, describe, expect, it } from 'vitest'
import { favCharacter, favFolder, favTemplate, useLibrary, type CharacterTemplate, type SectionTemplate } from '@/store/library'
import { canMoveFolder, dissolve, folderPaths, relocate, remapFavorites, remapOpenFolders, renamedPath, revertFavorites, workNames } from './library-ops'

describe('目录路径', () => {
  it('改名只换最后一层，名字里的 / 去掉', () => {
    expect(renamedPath('表情/笑', '微笑')).toBe('表情/微笑')
    expect(renamedPath('光照', ' 灯/光 ')).toBe('灯光')
  })
  it('relocate：整支挪走，别的不动', () => {
    const f = relocate('表情', '情绪/表情')
    expect(['表情', '表情/笑', '表情笑', '光照'].map(f)).toEqual(['情绪/表情', '情绪/表情/笑', '表情笑', '光照'])
    expect(relocate('表情/笑', '笑')('表情/笑/大笑')).toBe('笑/大笑')
  })
  it('dissolve：删掉这一层，里面的往上挪一级', () => {
    const f = dissolve('表情')
    expect(['表情', '表情/笑', '表情/哭/啜泣', '光照'].map(f)).toEqual(['', '笑', '哭/啜泣', '光照'])
    expect(dissolve('a/b')('a/b/c')).toBe('a/c')
    expect(dissolve('a/b')('a/b')).toBe('a')
  })
  it('目录不能拖进自己和自己下面；已经在那儿了也不算', () => {
    expect(canMoveFolder('表情', '表情/笑')).toBe(false)
    expect(canMoveFolder('表情', '表情')).toBe(false)
    expect(canMoveFolder('表情/笑', '表情')).toBe(false)
    expect(canMoveFolder('表情/笑', '')).toBe(true)
    expect(canMoveFolder('光照', '场景')).toBe(true)
  })
  it('目录列表含中间层；作品去重、空的不算', () => {
    expect(folderPaths(['表情/笑', '表情/哭', '', '光照'])).toEqual(['表情', '表情/哭', '表情/笑', '光照'].sort((a, b) => a.localeCompare(b, 'zh')))
    expect(workNames(['孤独摇滚！', undefined, ' ', '孤独摇滚！', '葬送的芙莉莲'])).toEqual(['孤独摇滚！', '葬送的芙莉莲'].sort((a, b) => a.localeCompare(b, 'zh')))
  })
})

describe('收藏 / 展开状态跟着目录走', () => {
  it('收藏的文件夹换路径；合并后重名只留一个；变成根目录的去掉', () => {
    const favs = ['folder:表情', 'template:a', 'folder:表情/笑', 'folder:笑']
    expect(remapFavorites(favs, dissolve('表情'))).toEqual(['template:a', 'folder:笑'])
    expect(remapFavorites(favs, relocate('表情', '情绪'))).toEqual(['folder:情绪', 'template:a', 'folder:情绪/笑', 'folder:笑'])
  })
  it('撤销只退这一步：新出现的拿掉、拿掉的放回原位，之后别的改动留着', () => {
    const before = ['folder:表情', 'template:a', 'folder:表情/笑']
    const after = remapFavorites(before, relocate('表情', '情绪'))
    expect(revertFavorites(after, before, after)).toEqual(before)
    expect(revertFavorites([...after, 'template:b'], before, after)).toEqual([...before, 'template:b'])
  })
  it('左栏的展开状态（路径 / ★路径）跟着换', () => {
    expect(remapOpenFolders({ 表情: true, '表情/笑': true, '★表情': true, 'work-closed:x': true }, relocate('表情', '情绪'))).toEqual({
      情绪: true,
      '情绪/笑': true,
      '★情绪': true,
      'work-closed:x': true,
    })
  })
})

const tpl = (id: string, folder: string): SectionTemplate => ({ id, name: id, color: 'sky', folder, chips: [], createdAt: 1 })
const chr = (id: string, work?: string): CharacterTemplate => ({ id, name: id, gender: 'female', color: 'pink', ...(work ? { work } : {}), prompt: [], uc: [], createdAt: 1 })

describe('模板库的批量操作 + toast 撤销', () => {
  beforeEach(() => {
    useLibrary.setState({
      sectionTemplates: [tpl('s1', '表情/笑'), tpl('s2', '表情/哭'), tpl('s3', '光照'), tpl('s4', ''), tpl('s5', '表情')],
      characterTemplates: [chr('c1', '葬送的芙莉莲'), chr('c2', '孤独摇滚'), chr('c3', '孤独摇滚！'), chr('c4')],
      favorites: [favFolder('表情'), favTemplate('s3'), favFolder('表情/笑'), favCharacter('c2')],
    })
  })
  const folders = () => Object.fromEntries(useLibrary.getState().sectionTemplates.map((t) => [t.id, t.folder]))
  const works = () => Object.fromEntries(useLibrary.getState().characterTemplates.map((t) => [t.id, t.work ?? '']))

  it('批量移动 + 撤销；已经在那儿的不算', () => {
    const u = useLibrary.getState().moveSectionTemplates(['s3', 's4', 's1'], '光照')
    expect(u.count).toBe(2)
    expect(folders()).toMatchObject({ s1: '光照', s3: '光照', s4: '光照' })
    useLibrary.getState().undoLibrary(u)
    expect(folders()).toMatchObject({ s1: '表情/笑', s3: '光照', s4: '' })
  })
  it('目录改名撞上已有的 = 合并；收藏跟着换；撤销回去', () => {
    const u = useLibrary.getState().remapFolders(relocate('表情/哭', '表情/笑'))
    expect(folders()).toMatchObject({ s1: '表情/笑', s2: '表情/笑' })
    expect(u.count).toBe(1)
    const v = useLibrary.getState().remapFolders(relocate('表情', '情绪'))
    expect(useLibrary.getState().favorites).toEqual([favFolder('情绪'), favTemplate('s3'), favFolder('情绪/笑'), favCharacter('c2')])
    useLibrary.getState().undoLibrary(v)
    useLibrary.getState().undoLibrary(u)
    expect(folders()).toMatchObject({ s1: '表情/笑', s2: '表情/哭', s5: '表情' })
    expect(useLibrary.getState().favorites).toEqual([favFolder('表情'), favTemplate('s3'), favFolder('表情/笑'), favCharacter('c2')])
  })
  it('删目录 = 去掉这一层，收藏的这个文件夹拿掉；撤销放回原位', () => {
    const u = useLibrary.getState().remapFolders(dissolve('表情'))
    expect(folders()).toEqual({ s1: '笑', s2: '哭', s3: '光照', s4: '', s5: '' })
    expect(useLibrary.getState().favorites).toEqual([favTemplate('s3'), favFolder('笑'), favCharacter('c2')])
    useLibrary.getState().undoLibrary(u)
    expect(useLibrary.getState().favorites).toEqual([favFolder('表情'), favTemplate('s3'), favFolder('表情/笑'), favCharacter('c2')])
  })
  it('作品改名 = 合并；删作品 = 进无所属作品', () => {
    const u = useLibrary.getState().remapWorks((w) => (w === '孤独摇滚' ? '孤独摇滚！' : w))
    expect(works()).toMatchObject({ c2: '孤独摇滚！', c3: '孤独摇滚！' })
    const v = useLibrary.getState().remapWorks((w) => (w === '孤独摇滚！' ? '' : w))
    expect(v.count).toBe(2)
    expect(useLibrary.getState().characterTemplates.find((t) => t.id === 'c2')).not.toHaveProperty('work')
    useLibrary.getState().undoLibrary(v)
    useLibrary.getState().undoLibrary(u)
    expect(works()).toMatchObject({ c2: '孤独摇滚', c3: '孤独摇滚！', c4: '' })
  })
  it('批量删除：一次撤销全部放回原位（收藏也回原来的顺序），不碰之后别的改动', () => {
    const u = useLibrary.getState().removeTemplates(['s1', 's3'], ['c2'])
    expect(u.count).toBe(3)
    expect(useLibrary.getState().sectionTemplates.map((t) => t.id)).toEqual(['s2', 's4', 's5'])
    expect(useLibrary.getState().favorites).toEqual([favFolder('表情'), favFolder('表情/笑')])
    useLibrary.getState().moveSectionTemplates(['s4'], '光照')
    useLibrary.getState().undoLibrary(u)
    expect(useLibrary.getState().sectionTemplates.map((t) => t.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(useLibrary.getState().characterTemplates.map((t) => t.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(useLibrary.getState().favorites).toEqual([favFolder('表情'), favTemplate('s3'), favFolder('表情/笑'), favCharacter('c2')])
    expect(folders().s4).toBe('光照')
  })
})

describe('库 v6 → 最新：去掉没改过的示例', () => {
  const migrate = useLibrary.persist.getOptions().migrate!
  it('v7 补上的雨天 / 圆眼镜和三个只在库里的角色和现在的示例一样 → v9 删掉；和示例对不上的（同名但内容不同）、用户自己的不动', async () => {
    const old = {
      sectionTemplates: [tpl('mine', '我的'), { ...tpl('rain', ''), name: '雨天', createdAt: 0 }],
      characterTemplates: [chr('mine-c', '我的作品'), { ...chr('x', '孤独摇滚'), name: '伊地知虹夏', createdAt: 0 }],
      favorites: [favTemplate('mine'), favTemplate('gone')],
    }
    const s = (await migrate(structuredClone(old), 6)) as { sectionTemplates: SectionTemplate[]; characterTemplates: CharacterTemplate[]; favorites: string[] }
    expect(s.sectionTemplates.map((t) => t.name)).toEqual(['mine', '雨天'])
    expect(s.characterTemplates.map((t) => t.name)).toEqual(['mine-c', '伊地知虹夏'])
    expect(s.favorites).toEqual([favTemplate('mine')])
  })
})
