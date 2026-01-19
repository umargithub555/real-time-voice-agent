import torch 



device =  'cuda' if torch.cuda.is_available() else 'cpu'

print(torch.cuda.is_available())  # Should print True
print(torch.version.cuda)         # Prints your CUDA version

print(device)