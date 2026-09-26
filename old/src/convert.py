from fpdf import FPDF, Align
from PIL import Image, ImageDraw
import glob
import os

def in2mm(inch):
  return inch*25.6
def mm2inch(mm):
  return mm/25.6
def cm2inch(cm):
  return cm/2.56
def in2cm(inch):
  return inch*2.56

pdf_size_inch=3.5

factor=1.009
base_width=63*factor
base_height=88*factor

image_padding=[2.8,2.8, 2.8,2.8]
#image_padding=[0,0,0,0]

x_offset = 0.25 # was 0.2

x_offset = mm2inch(x_offset)

corner_radius=2

  
def mm2pixel(mm):
  return mm*img_y_pixel/base_height

def get_cardname(image_name):
  return image_name.split(' (')[0].split(' [')[0]


pdf = FPDF(orientation = 'P', unit = 'in', format=(pdf_size_inch, pdf_size_inch))
pdf.set_margin(0)

pwd = os.getcwd()
for image_name in [x for x in glob.glob(os.path.join(pwd, '*.jpg'))+glob.glob(os.path.join(pwd, '*.jpeg'))+glob.glob(os.path.join(pwd, '*.png')) if x[0]!='_']:
  print(image_name)

  img = Image.open(image_name)

  img_x_pixel,img_y_pixel = img.size

  cutoff=[mm2pixel(x) for x in image_padding]

  img_cropped = img.crop((cutoff[0], cutoff[1], img_x_pixel-cutoff[2], img_y_pixel-cutoff[3]))
  #img_cropped.save('rounded_a_card.png', format='PNG')

  mask = Image.new('L', img_cropped.size, 0)
  draw = ImageDraw.Draw(mask)
  draw.rounded_rectangle(
    [(0, 0), img_cropped.size],
    radius=mm2pixel(corner_radius),
    fill=255
  )

  rounded_image = Image.new('RGBA', img_cropped.size)
  rounded_image.paste(img_cropped, (0, 0), mask)

  # Save the result
  rounded_image.save(image_name+"_", format='PNG')

  img_x_pixel,img_y_pixel = rounded_image.size
  
  placement_x=(pdf_size_inch-mm2inch(base_width))/2+x_offset
  print(placement_x)
  pdf.add_page()
  pdf.image(image_name+"_", x=placement_x, y=0, h=mm2inch(base_height), keep_aspect_ratio=True)
   
pdf.output('output.pdf', 'F')


